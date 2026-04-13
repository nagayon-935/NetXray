use crate::types::AclRule;

pub struct PacketHeader {
    pub src_ip: String,
    pub dst_ip: String,
    pub protocol: String,
    pub src_port: Option<u16>,
    pub dst_port: Option<u16>,
}

#[derive(Debug, Clone)]
pub enum AclAction {
    Permit,
    Deny,
    NoMatch,
}

#[derive(Debug, Clone)]
pub struct AclResult {
    pub action: AclAction,
    pub matched_seq: Option<u32>,
}

pub fn evaluate_acl(rules: &[AclRule], packet: &PacketHeader) -> AclResult {
    for rule in rules {
        if rule.protocol != "any" && rule.protocol != packet.protocol {
            continue;
        }
        if let Some(dst_port) = rule.dst_port {
            if Some(dst_port) != packet.dst_port {
                continue;
            }
        }
        if let Some(src_port) = rule.src_port {
            if Some(src_port) != packet.src_port {
                continue;
            }
        }
        if rule.src != "any" && !ip_matches_cidr(&packet.src_ip, &rule.src) {
            continue;
        }
        if rule.dst != "any" && !ip_matches_cidr(&packet.dst_ip, &rule.dst) {
            continue;
        }
        let action = if rule.action == "permit" {
            AclAction::Permit
        } else {
            AclAction::Deny
        };
        return AclResult { action, matched_seq: Some(rule.seq) };
    }
    AclResult { action: AclAction::NoMatch, matched_seq: None }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ShadowedRule {
    pub acl_name: String,
    pub shadowed_seq: u32,
    pub shadowed_by_seq: u32,
    pub reason: String,
}

pub fn detect_shadows(acl_name: &str, rules: &[AclRule]) -> Vec<ShadowedRule> {
    let mut shadows = Vec::new();
    for i in 0..rules.len() {
        for j in (i + 1)..rules.len() {
            if rule_is_shadowed_by(&rules[j], &rules[i]) {
                shadows.push(ShadowedRule {
                    acl_name: acl_name.to_string(),
                    shadowed_seq: rules[j].seq,
                    shadowed_by_seq: rules[i].seq,
                    reason: build_shadow_reason(&rules[i], &rules[j]),
                });
            }
        }
    }
    shadows
}

fn rule_is_shadowed_by(candidate: &AclRule, earlier: &AclRule) -> bool {
    if earlier.protocol != "any" && earlier.protocol != candidate.protocol {
        return false;
    }
    if !cidr_contains(&earlier.src, &candidate.src) {
        return false;
    }
    if !cidr_contains(&earlier.dst, &candidate.dst) {
        return false;
    }
    if let Some(ep) = earlier.dst_port {
        match candidate.dst_port {
            Some(cp) if cp == ep => {}
            _ => return false,
        }
    }
    if let Some(ep) = earlier.src_port {
        match candidate.src_port {
            Some(cp) if cp == ep => {}
            _ => return false,
        }
    }
    true
}

fn build_shadow_reason(earlier: &AclRule, later: &AclRule) -> String {
    if earlier.action == later.action {
        format!("Both rules {} — seq {} is redundant", earlier.action, later.seq)
    } else {
        format!(
            "Seq {} ({}) is unreachable due to seq {} ({})",
            later.seq, later.action, earlier.seq, earlier.action
        )
    }
}

fn ip_matches_cidr(ip: &str, cidr: &str) -> bool {
    if cidr == "any" {
        return true;
    }
    let (net, prefix_str) = match cidr.split_once('/') {
        Some(p) => p,
        None => return ip == cidr,
    };
    let prefix: u32 = prefix_str.parse().unwrap_or(32);
    let ip_num = ip_to_num(ip);
    let net_num = ip_to_num(net);
    let mask = if prefix == 0 { 0u32 } else { (!0u32) << (32 - prefix) };
    (ip_num & mask) == (net_num & mask)
}

fn cidr_contains(outer: &str, inner: &str) -> bool {
    if outer == "any" {
        return true;
    }
    if inner == "any" {
        return false;
    }
    if outer == inner {
        return true;
    }
    let (outer_net, outer_prefix_str) = match outer.split_once('/') {
        Some(p) => p,
        None => (outer, "32"),
    };
    let (inner_net, inner_prefix_str) = match inner.split_once('/') {
        Some(p) => p,
        None => (inner, "32"),
    };
    let outer_prefix: u32 = outer_prefix_str.parse().unwrap_or(32);
    let inner_prefix: u32 = inner_prefix_str.parse().unwrap_or(32);
    if outer_prefix > inner_prefix {
        return false;
    }
    let mask = if outer_prefix == 0 { 0u32 } else { (!0u32) << (32 - outer_prefix) };
    (ip_to_num(outer_net) & mask) == (ip_to_num(inner_net) & mask)
}

fn ip_to_num(ip: &str) -> u32 {
    ip.split('.')
        .fold(0u32, |acc, octet| {
            (acc << 8) | octet.parse::<u32>().unwrap_or(0)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rules() -> Vec<AclRule> {
        vec![
            AclRule { seq: 10, action: "permit".into(), protocol: "tcp".into(), src: "any".into(), dst: "any".into(), src_port: None, dst_port: Some(80) },
            AclRule { seq: 20, action: "deny".into(), protocol: "tcp".into(), src: "10.0.0.0/8".into(), dst: "any".into(), src_port: None, dst_port: None },
            AclRule { seq: 30, action: "permit".into(), protocol: "any".into(), src: "any".into(), dst: "any".into(), src_port: None, dst_port: None },
        ]
    }

    #[test]
    fn test_permit_on_port_80() {
        let rules = make_rules();
        let pkt = PacketHeader { src_ip: "1.2.3.4".into(), dst_ip: "5.6.7.8".into(), protocol: "tcp".into(), src_port: None, dst_port: Some(80) };
        let result = evaluate_acl(&rules, &pkt);
        assert!(matches!(result.action, AclAction::Permit));
        assert_eq!(result.matched_seq, Some(10));
    }

    #[test]
    fn test_deny_rfc1918() {
        let rules = make_rules();
        let pkt = PacketHeader { src_ip: "10.1.2.3".into(), dst_ip: "5.6.7.8".into(), protocol: "tcp".into(), src_port: None, dst_port: Some(443) };
        let result = evaluate_acl(&rules, &pkt);
        assert!(matches!(result.action, AclAction::Deny));
        assert_eq!(result.matched_seq, Some(20));
    }

    #[test]
    fn test_permit_any() {
        let rules = make_rules();
        let pkt = PacketHeader { src_ip: "192.168.1.1".into(), dst_ip: "8.8.8.8".into(), protocol: "icmp".into(), src_port: None, dst_port: None };
        let result = evaluate_acl(&rules, &pkt);
        assert!(matches!(result.action, AclAction::Permit));
        assert_eq!(result.matched_seq, Some(30));
    }

    #[test]
    fn test_no_match() {
        let rules = vec![
            AclRule { seq: 10, action: "permit".into(), protocol: "tcp".into(), src: "any".into(), dst: "any".into(), src_port: None, dst_port: Some(80) },
        ];
        let pkt = PacketHeader { src_ip: "1.2.3.4".into(), dst_ip: "5.6.7.8".into(), protocol: "udp".into(), src_port: None, dst_port: Some(53) };
        let result = evaluate_acl(&rules, &pkt);
        assert!(matches!(result.action, AclAction::NoMatch));
    }

    #[test]
    fn test_detect_shadows() {
        let rules = vec![
            AclRule { seq: 10, action: "permit".into(), protocol: "any".into(), src: "any".into(), dst: "any".into(), src_port: None, dst_port: None },
            AclRule { seq: 20, action: "deny".into(), protocol: "tcp".into(), src: "10.0.0.0/8".into(), dst: "any".into(), src_port: None, dst_port: None },
        ];
        let shadows = detect_shadows("TEST_ACL", &rules);
        assert_eq!(shadows.len(), 1);
        assert_eq!(shadows[0].shadowed_seq, 20);
        assert_eq!(shadows[0].shadowed_by_seq, 10);
    }

    #[test]
    fn test_no_shadows() {
        let rules = vec![
            AclRule { seq: 10, action: "deny".into(), protocol: "tcp".into(), src: "any".into(), dst: "any".into(), src_port: None, dst_port: Some(22) },
            AclRule { seq: 20, action: "permit".into(), protocol: "any".into(), src: "any".into(), dst: "any".into(), src_port: None, dst_port: None },
        ];
        let shadows = detect_shadows("TEST_ACL", &rules);
        assert_eq!(shadows.len(), 0);
    }

    #[test]
    fn test_cidr_contains() {
        assert!(cidr_contains("10.0.0.0/8", "10.1.2.0/24"));
        assert!(!cidr_contains("10.1.2.0/24", "10.0.0.0/8"));
        assert!(cidr_contains("any", "10.0.0.0/8"));
        assert!(!cidr_contains("10.0.0.0/8", "any"));
    }
}
