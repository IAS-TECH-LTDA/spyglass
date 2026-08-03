use std::net::{IpAddr, Ipv4Addr, UdpSocket};

use serde::Serialize;

use crate::ws_server;

/// One LAN-reachable address a physical device could use to reach this
/// machine. Surfaced by the desktop's empty-state screen (`ConnectView`) so
/// a dev doesn't have to go find their own IP.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LanAddress {
    pub ip: String,
    pub interface_name: String,
    pub is_primary: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub port: u16,
    pub addresses: Vec<LanAddress>,
}

/// Interface name prefixes that never lead anywhere a phone can reach:
/// macOS's VPN/tunnel/AWDL/virtual-networking pseudo-interfaces, and their
/// rough Linux/container equivalents. Filtered out so the connection screen
/// doesn't list addresses that look plausible but never work.
const IGNORED_PREFIXES: &[&str] = &[
    // macOS
    "utun", "awdl", "llw", "bridge", "anpi", "ap1", "vmnet", "gif", "stf", //
    // Linux / containers
    "docker", "veth", "br-", "virbr", "tun", "tap",
];

fn is_ignored_interface(name: &str) -> bool {
    IGNORED_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

fn is_link_local(ip: Ipv4Addr) -> bool {
    ip.octets()[0] == 169 && ip.octets()[1] == 254
}

/// Lower ranks sort first. Only breaks ties when the outbound-probe below
/// couldn't pick a primary (e.g. this machine is offline) — a reasonable
/// guess at which interface a dev is actually using.
fn interface_rank(name: &str) -> u8 {
    if name.starts_with("en0") || name.starts_with("wlan0") {
        0
    } else if name.starts_with("en") || name.starts_with("eth") {
        1
    } else {
        2
    }
}

/// Best-guess "this is the address a phone on the same network would use"
/// probe: binds a UDP socket and `connect()`s it to a non-local address —
/// UDP `connect()` only picks a route, it never sends a packet — then reads
/// back which local address the OS chose to source from. This never touches
/// the network and, because the destination isn't on the LAN, doesn't trip
/// macOS's local-network privacy prompt the way pinging a LAN peer would.
fn primary_outbound_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) => Some(ip),
        IpAddr::V6(_) => None,
    }
}

/// Enumerates this machine's LAN-reachable IPv4 addresses, ranked so the one
/// a physical device should try first comes first. IPv6 is out of scope
/// (nobody pastes a bracketed literal into a `host` snippet) — see spec
/// 0002's "fora de escopo".
pub fn list_lan_addresses() -> Vec<LanAddress> {
    let interfaces = match if_addrs::get_if_addrs() {
        Ok(interfaces) => interfaces,
        Err(_) => return Vec::new(),
    };
    let primary = primary_outbound_ipv4();

    let mut addresses: Vec<LanAddress> = interfaces
        .into_iter()
        .filter(|iface| !iface.is_loopback() && !is_ignored_interface(&iface.name))
        .filter_map(|iface| match iface.ip() {
            IpAddr::V4(ip) if !is_link_local(ip) => Some(LanAddress {
                is_primary: Some(ip) == primary,
                ip: ip.to_string(),
                interface_name: iface.name,
            }),
            _ => None,
        })
        .collect();

    addresses.sort_by(|a, b| {
        b.is_primary
            .cmp(&a.is_primary)
            .then_with(|| interface_rank(&a.interface_name).cmp(&interface_rank(&b.interface_name)))
            .then_with(|| a.interface_name.cmp(&b.interface_name))
    });

    addresses
}

pub fn connection_info() -> ConnectionInfo {
    ConnectionInfo { port: ws_server::PORT, addresses: list_lan_addresses() }
}

#[tauri::command]
pub fn get_connection_info() -> ConnectionInfo {
    connection_info()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_macos_pseudo_interfaces() {
        for name in ["utun0", "utun5", "awdl0", "llw0", "bridge0", "anpi0", "ap1", "vmnet1"] {
            assert!(is_ignored_interface(name), "{name} should be ignored");
        }
    }

    #[test]
    fn ignores_linux_container_interfaces() {
        for name in ["docker0", "veth1234", "br-abcdef", "virbr0", "tun0", "tap0"] {
            assert!(is_ignored_interface(name), "{name} should be ignored");
        }
    }

    #[test]
    fn does_not_ignore_real_interfaces() {
        for name in ["en0", "en5", "wlan0", "eth0"] {
            assert!(!is_ignored_interface(name), "{name} should not be ignored");
        }
    }

    #[test]
    fn detects_link_local_addresses() {
        assert!(is_link_local(Ipv4Addr::new(169, 254, 1, 1)));
        assert!(!is_link_local(Ipv4Addr::new(192, 168, 1, 1)));
    }

    #[test]
    fn ranks_primary_wifi_and_ethernet_names_above_everything_else() {
        assert!(interface_rank("en0") < interface_rank("en5"));
        assert!(interface_rank("wlan0") < interface_rank("wlan1"));
        assert!(interface_rank("en0") < interface_rank("utun0"));
    }
}
