use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NetXrayIR {
    pub ir_version: String,
    pub topology: Topology,
    pub policies: Option<Policies>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Topology {
    pub nodes: Vec<Node>,
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub vendor: Option<String>,
    pub hostname: Option<String>,
    pub interfaces: Option<HashMap<String, Interface>>,
    pub vrfs: Option<HashMap<String, Vrf>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Interface {
    pub ip: Option<String>,
    pub state: Option<String>,
    pub cost: Option<u32>,
    pub acl_in: Option<String>,
    pub acl_out: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Vrf {
    pub routing_table: Option<Vec<Route>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Route {
    pub prefix: String,
    pub next_hop: String,
    pub protocol: Option<String>,
    pub metric: Option<u32>,
    pub via_interface: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Link {
    pub id: String,
    pub source: LinkEndpoint,
    pub target: LinkEndpoint,
    pub state: Option<String>,
    pub bandwidth: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LinkEndpoint {
    pub node: String,
    pub interface: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Policies {
    pub acls: Option<HashMap<String, Vec<AclRule>>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AclRule {
    pub seq: u32,
    pub action: String,
    pub protocol: String,
    pub src: String,
    pub dst: String,
    pub src_port: Option<u16>,
    pub dst_port: Option<u16>,
}
