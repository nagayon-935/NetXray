use std::collections::HashMap;
use petgraph::stable_graph::{NodeIndex, StableGraph};
use petgraph::visit::EdgeRef;
use petgraph::Undirected;

use crate::types::{Link, NetXrayIR, Node};

pub struct TopologyGraph {
    pub graph: StableGraph<String, EdgeData, Undirected>,
    pub node_index: HashMap<String, NodeIndex>,
    pub nodes: HashMap<String, Node>,
}

#[derive(Debug, Clone)]
pub struct EdgeData {
    pub link: Link,
    pub cost_src: u32,
    pub cost_tgt: u32,
}

impl TopologyGraph {
    pub fn build(ir: &NetXrayIR) -> Self {
        let mut graph: StableGraph<String, EdgeData, Undirected> = Default::default();
        let mut node_index = HashMap::new();
        let mut nodes = HashMap::new();

        for node in &ir.topology.nodes {
            let idx = graph.add_node(node.id.clone());
            node_index.insert(node.id.clone(), idx);
            nodes.insert(node.id.clone(), node.clone());
        }

        for link in &ir.topology.links {
            if link.state.as_deref() == Some("down") {
                continue;
            }
            let src_idx = match node_index.get(&link.source.node) {
                Some(idx) => *idx,
                None => continue,
            };
            let tgt_idx = match node_index.get(&link.target.node) {
                Some(idx) => *idx,
                None => continue,
            };

            let cost_src = nodes
                .get(&link.source.node)
                .and_then(|n| n.interfaces.as_ref())
                .and_then(|ifaces| ifaces.get(&link.source.interface))
                .and_then(|iface| iface.cost)
                .unwrap_or(10);

            let cost_tgt = nodes
                .get(&link.target.node)
                .and_then(|n| n.interfaces.as_ref())
                .and_then(|ifaces| ifaces.get(&link.target.interface))
                .and_then(|iface| iface.cost)
                .unwrap_or(10);

            graph.add_edge(
                src_idx,
                tgt_idx,
                EdgeData {
                    link: link.clone(),
                    cost_src,
                    cost_tgt,
                },
            );
        }

        TopologyGraph {
            graph,
            node_index,
            nodes,
        }
    }

    pub fn find_node_by_ip(&self, ip: &str) -> Option<&Node> {
        for node in self.nodes.values() {
            if let Some(ifaces) = &node.interfaces {
                for iface in ifaces.values() {
                    if let Some(iface_ip) = &iface.ip {
                        if iface_ip.split('/').next() == Some(ip) {
                            return Some(node);
                        }
                    }
                }
            }
        }
        None
    }

    pub fn find_link_between(&self, node_a: &str, node_b: &str) -> Option<&Link> {
        let idx_a = self.node_index.get(node_a)?;
        let idx_b = self.node_index.get(node_b)?;

        for edge in self.graph.edges(*idx_a) {
            let other = if edge.source() == *idx_a { edge.target() } else { edge.source() };
            if other == *idx_b {
                return Some(&edge.weight().link);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_ir() -> NetXrayIR {
        NetXrayIR {
            ir_version: "0.1.0".into(),
            topology: Topology {
                nodes: vec![
                    Node {
                        id: "r1".into(),
                        node_type: "router".into(),
                        vendor: None,
                        hostname: None,
                        interfaces: Some({
                            let mut m = HashMap::new();
                            m.insert("eth0".into(), Interface {
                                ip: Some("10.0.0.1/30".into()),
                                state: Some("up".into()),
                                cost: Some(10),
                                acl_in: None,
                                acl_out: None,
                            });
                            m
                        }),
                        vrfs: None,
                    },
                    Node {
                        id: "r2".into(),
                        node_type: "router".into(),
                        vendor: None,
                        hostname: None,
                        interfaces: Some({
                            let mut m = HashMap::new();
                            m.insert("eth0".into(), Interface {
                                ip: Some("10.0.0.2/30".into()),
                                state: Some("up".into()),
                                cost: Some(10),
                                acl_in: None,
                                acl_out: None,
                            });
                            m
                        }),
                        vrfs: None,
                    },
                ],
                links: vec![Link {
                    id: "l1".into(),
                    source: LinkEndpoint { node: "r1".into(), interface: "eth0".into() },
                    target: LinkEndpoint { node: "r2".into(), interface: "eth0".into() },
                    state: Some("up".into()),
                    bandwidth: None,
                }],
            },
            policies: None,
        }
    }

    #[test]
    fn test_build_graph_nodes() {
        let ir = make_ir();
        let tg = TopologyGraph::build(&ir);
        assert_eq!(tg.nodes.len(), 2);
        assert!(tg.node_index.contains_key("r1"));
        assert!(tg.node_index.contains_key("r2"));
    }

    #[test]
    fn test_find_node_by_ip() {
        let ir = make_ir();
        let tg = TopologyGraph::build(&ir);
        let node = tg.find_node_by_ip("10.0.0.1");
        assert!(node.is_some());
        assert_eq!(node.unwrap().id, "r1");
    }

    #[test]
    fn test_down_link_excluded() {
        let mut ir = make_ir();
        ir.topology.links[0].state = Some("down".into());
        let tg = TopologyGraph::build(&ir);
        assert_eq!(tg.graph.edge_count(), 0);
    }
}
