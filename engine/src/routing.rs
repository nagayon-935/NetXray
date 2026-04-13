use std::collections::{BinaryHeap, HashMap};
use std::cmp::Reverse;
use petgraph::visit::EdgeRef;

use crate::topology::TopologyGraph;

/// Returns the ordered list of node IDs on the shortest path from src to dst,
/// or None if no path exists.
pub fn dijkstra(graph: &TopologyGraph, src_id: &str, dst_id: &str) -> Option<Vec<String>> {
    let src_idx = *graph.node_index.get(src_id)?;
    let dst_idx = *graph.node_index.get(dst_id)?;

    // (cost, node_index)
    let mut heap: BinaryHeap<Reverse<(u32, petgraph::stable_graph::NodeIndex)>> =
        BinaryHeap::new();
    let mut dist: HashMap<petgraph::stable_graph::NodeIndex, u32> = HashMap::new();
    let mut prev: HashMap<petgraph::stable_graph::NodeIndex, petgraph::stable_graph::NodeIndex> =
        HashMap::new();

    for node_idx in graph.graph.node_indices() {
        dist.insert(node_idx, u32::MAX);
    }
    dist.insert(src_idx, 0);
    heap.push(Reverse((0, src_idx)));

    while let Some(Reverse((cost, u))) = heap.pop() {
        if cost > *dist.get(&u).unwrap_or(&u32::MAX) {
            continue;
        }
        if u == dst_idx {
            break;
        }
        for edge in graph.graph.edges(u) {
            let v = if edge.source() == u { edge.target() } else { edge.source() };
            let edge_cost = if edge.weight().link.source.node == graph.graph[u] {
                edge.weight().cost_src
            } else {
                edge.weight().cost_tgt
            };
            let new_cost = cost.saturating_add(edge_cost);
            if new_cost < *dist.get(&v).unwrap_or(&u32::MAX) {
                dist.insert(v, new_cost);
                prev.insert(v, u);
                heap.push(Reverse((new_cost, v)));
            }
        }
    }

    if *dist.get(&dst_idx).unwrap_or(&u32::MAX) == u32::MAX {
        return None;
    }

    let mut path = Vec::new();
    let mut current = dst_idx;
    loop {
        path.push(graph.graph[current].clone());
        if current == src_idx {
            break;
        }
        match prev.get(&current) {
            Some(&p) => current = p,
            None => return None,
        }
    }
    path.reverse();
    Some(path)
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn triangle_ir() -> NetXrayIR {
        NetXrayIR {
            ir_version: "0.1.0".into(),
            topology: Topology {
                nodes: vec![
                    Node { id: "r1".into(), node_type: "router".into(), vendor: None, hostname: None, interfaces: None, vrfs: None },
                    Node { id: "r2".into(), node_type: "router".into(), vendor: None, hostname: None, interfaces: None, vrfs: None },
                    Node { id: "r3".into(), node_type: "router".into(), vendor: None, hostname: None, interfaces: None, vrfs: None },
                ],
                links: vec![
                    Link { id: "l1".into(), source: LinkEndpoint { node: "r1".into(), interface: "eth0".into() }, target: LinkEndpoint { node: "r2".into(), interface: "eth0".into() }, state: Some("up".into()), bandwidth: None },
                    Link { id: "l2".into(), source: LinkEndpoint { node: "r2".into(), interface: "eth1".into() }, target: LinkEndpoint { node: "r3".into(), interface: "eth0".into() }, state: Some("up".into()), bandwidth: None },
                    Link { id: "l3".into(), source: LinkEndpoint { node: "r1".into(), interface: "eth1".into() }, target: LinkEndpoint { node: "r3".into(), interface: "eth1".into() }, state: Some("up".into()), bandwidth: None },
                ],
            },
            policies: None,
        }
    }

    #[test]
    fn test_direct_path() {
        let ir = triangle_ir();
        let g = TopologyGraph::build(&ir);
        let path = dijkstra(&g, "r1", "r2").unwrap();
        assert_eq!(path, vec!["r1", "r2"]);
    }

    #[test]
    fn test_indirect_path() {
        let ir = triangle_ir();
        let g = TopologyGraph::build(&ir);
        let path = dijkstra(&g, "r1", "r3").unwrap();
        // Either r1→r3 directly or r1→r2→r3; both are cost 10
        assert!(path.first().unwrap() == "r1");
        assert!(path.last().unwrap() == "r3");
    }

    #[test]
    fn test_unreachable() {
        let mut ir = triangle_ir();
        ir.topology.links[0].state = Some("down".into());
        ir.topology.links[2].state = Some("down".into());
        let g = TopologyGraph::build(&ir);
        assert!(dijkstra(&g, "r1", "r2").is_none());
    }

    #[test]
    fn test_self_path() {
        let ir = triangle_ir();
        let g = TopologyGraph::build(&ir);
        let path = dijkstra(&g, "r1", "r1").unwrap();
        assert_eq!(path, vec!["r1"]);
    }
}
