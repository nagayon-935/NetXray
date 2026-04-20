mod acl;
mod routing;
mod topology;
mod types;

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

use acl::{AclAction, evaluate_acl, detect_shadows, PacketHeader};
use routing::dijkstra;
use topology::TopologyGraph;
use types::NetXrayIR;

// ---------------------------------------------------------------------------
// JS-facing output types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct JsPathHop {
    node_id: String,
    ingress_interface: Option<String>,
    egress_interface: Option<String>,
    acl_result: Option<JsAclResult>,
}

#[derive(Serialize)]
struct JsAclResult {
    acl_name: String,
    matched_seq: Option<u32>,
    action: String,
}

#[derive(Serialize)]
struct JsPacketPath {
    hops: Vec<JsPathHop>,
    result: String,
    drop_reason: Option<String>,
}

#[derive(Deserialize)]
struct JsPacketHeader {
    src_ip: String,
    dst_ip: String,
    protocol: String,
    src_port: Option<u16>,
    dst_port: Option<u16>,
}

// ---------------------------------------------------------------------------
// Engine state (thread_local for WASM single-threaded runtime)
// ---------------------------------------------------------------------------

thread_local! {
    static ENGINE: std::cell::RefCell<Option<EngineState>> = std::cell::RefCell::new(None);
}

struct EngineState {
    ir: NetXrayIR,
    graph: TopologyGraph,
}

// ---------------------------------------------------------------------------
// WASM API
// ---------------------------------------------------------------------------

/// Load (or reload) the topology from an IR JSON string.
/// Returns an error string on failure.
#[wasm_bindgen]
pub fn load_topology(ir_json: &str) -> Result<(), JsValue> {
    let ir: NetXrayIR = serde_json::from_str(ir_json)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse IR: {e}")))?;

    let graph = TopologyGraph::build(&ir);
    ENGINE.with(|e| {
        *e.borrow_mut() = Some(EngineState { ir, graph });
    });
    Ok(())
}

/// Simulate packet traversal through the topology.
/// `packet_json` should be `{ src_ip, dst_ip, protocol, src_port?, dst_port? }`.
/// Returns a `PacketPath` JSON object.
#[wasm_bindgen]
pub fn simulate_packet(packet_json: &str) -> Result<JsValue, JsValue> {
    let header: JsPacketHeader = serde_json::from_str(packet_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid packet: {e}")))?;

    ENGINE.with(|e| {
        let state_ref = e.borrow();
        let state = state_ref.as_ref().ok_or_else(|| JsValue::from_str("No topology loaded"))?;

        let src_node = state.graph.find_node_by_ip(&header.src_ip)
            .ok_or_else(|| JsValue::from_str(&format!("Source IP {} not found", header.src_ip)))?;
        let dst_node = state.graph.find_node_by_ip(&header.dst_ip)
            .ok_or_else(|| JsValue::from_str(&format!("Destination IP {} not found", header.dst_ip)))?;

        let path = match dijkstra(&state.graph, &src_node.id.clone(), &dst_node.id.clone()) {
            Some(p) => p,
            None => {
                let result = JsPacketPath {
                    hops: vec![],
                    result: "unreachable".into(),
                    drop_reason: Some("No route to destination".into()),
                };
                return json_to_jsvalue(result);
            }
        };

        let acl_packet = PacketHeader {
            src_ip: header.src_ip.clone(),
            dst_ip: header.dst_ip.clone(),
            protocol: header.protocol.clone(),
            src_port: header.src_port,
            dst_port: header.dst_port,
        };

        let mut hops: Vec<JsPathHop> = Vec::new();
        for i in 0..path.len() {
            let node_id = &path[i];

            let ingress_iface = if i > 0 {
                state.graph.find_link_between(&path[i - 1], node_id).map(|link| {
                    if link.source.node == *node_id {
                        link.source.interface.clone()
                    } else {
                        link.target.interface.clone()
                    }
                })
            } else {
                None
            };

            let egress_iface = if i < path.len() - 1 {
                state.graph.find_link_between(node_id, &path[i + 1]).map(|link| {
                    if link.source.node == *node_id {
                        link.source.interface.clone()
                    } else {
                        link.target.interface.clone()
                    }
                })
            } else {
                None
            };

            // Evaluate ingress ACL if present
            if let Some(ref iface_name) = ingress_iface {
                if let Some(node) = state.graph.nodes.get(node_id) {
                    if let Some(acl_name) = node.interfaces.as_ref()
                        .and_then(|ifaces| ifaces.get(iface_name))
                        .and_then(|iface| iface.acl_in.as_ref())
                    {
                        if let Some(rules) = state.ir.policies.as_ref()
                            .and_then(|p| p.acls.as_ref())
                            .and_then(|acls| acls.get(acl_name))
                        {
                            let result = evaluate_acl(rules, &acl_packet);
                            let action_str = match result.action {
                                AclAction::Permit => "permit",
                                AclAction::Deny => "deny",
                                AclAction::NoMatch => "no-match",
                            };
                            let hop = JsPathHop {
                                node_id: node_id.clone(),
                                ingress_interface: ingress_iface.clone(),
                                egress_interface: egress_iface.clone(),
                                acl_result: Some(JsAclResult {
                                    acl_name: acl_name.clone(),
                                    matched_seq: result.matched_seq,
                                    action: action_str.to_string(),
                                }),
                            };
                            let is_deny = matches!(result.action, AclAction::Deny);
                            hops.push(hop);
                            if is_deny {
                                let out = JsPacketPath {
                                    hops,
                                    result: "dropped".into(),
                                    drop_reason: Some(format!("Denied by {} seq {:?}", acl_name, result.matched_seq)),
                                };
                                return json_to_jsvalue(out);
                            }
                            continue;
                        }
                    }
                }
            }

            hops.push(JsPathHop {
                node_id: node_id.clone(),
                ingress_interface: ingress_iface,
                egress_interface: egress_iface,
                acl_result: None,
            });
        }

        let out = JsPacketPath { hops, result: "delivered".into(), drop_reason: None };
        json_to_jsvalue(out)
    })
}

/// Detect ACL shadowing for a named ACL.
/// Returns a JSON array of `ShadowedRule` objects.
#[wasm_bindgen]
pub fn detect_acl_shadows(acl_name: &str) -> Result<JsValue, JsValue> {
    ENGINE.with(|e| {
        let state_ref = e.borrow();
        let state = state_ref.as_ref().ok_or_else(|| JsValue::from_str("No topology loaded"))?;

        let rules = state.ir.policies.as_ref()
            .and_then(|p| p.acls.as_ref())
            .and_then(|acls| acls.get(acl_name))
            .ok_or_else(|| JsValue::from_str(&format!("ACL {acl_name} not found")))?;

        let shadows = detect_shadows(acl_name, rules);
        json_to_jsvalue(shadows)
    })
}

/// Standalone ACL evaluation against the loaded IR.
/// `packet_json` should be `{ src_ip, dst_ip, protocol, src_port?, dst_port? }`.
/// Returns `{ acl_name, matched_seq, action }`.
#[wasm_bindgen]
pub fn evaluate_acl_named(acl_name: &str, packet_json: &str) -> Result<JsValue, JsValue> {
    let header: JsPacketHeader = serde_json::from_str(packet_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid packet: {e}")))?;

    ENGINE.with(|e| {
        let state_ref = e.borrow();
        let state = state_ref.as_ref().ok_or_else(|| JsValue::from_str("No topology loaded"))?;

        let rules = state.ir.policies.as_ref()
            .and_then(|p| p.acls.as_ref())
            .and_then(|acls| acls.get(acl_name))
            .ok_or_else(|| JsValue::from_str(&format!("ACL {acl_name} not found")))?;

        let acl_packet = PacketHeader {
            src_ip: header.src_ip,
            dst_ip: header.dst_ip,
            protocol: header.protocol,
            src_port: header.src_port,
            dst_port: header.dst_port,
        };
        let result = evaluate_acl(rules, &acl_packet);
        let action_str = match result.action {
            AclAction::Permit => "permit",
            AclAction::Deny => "deny",
            AclAction::NoMatch => "no-match",
        };
        json_to_jsvalue(JsAclResult {
            acl_name: acl_name.to_string(),
            matched_seq: result.matched_seq,
            action: action_str.to_string(),
        })
    })
}

// ---------------------------------------------------------------------------
// Helper: serialize to JsValue via JSON string
// ---------------------------------------------------------------------------

fn json_to_jsvalue<T: Serialize>(val: T) -> Result<JsValue, JsValue> {
    let s = serde_json::to_string(&val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_str(&s))
}

