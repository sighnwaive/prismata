import React, { useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ConnectionRequest, DesktopEndpoint } from "@prismata/sync";
import { mobileDesktopRuntime } from "./desktop-runtime";
import { parseIncomingPairingValue } from "./qr-scanner";

export type AuthFlowScreenProps = { advertisements?: Iterable<unknown> };
type FlowState = "discovering" | "ready" | "confirming" | "pairing" | "success" | "offline" | "error";
const noAdvertisements: Iterable<unknown> = [];

export function parseIncomingDeepLink(url: string) {
  return parseIncomingPairingValue(url);
}

export default function AuthFlowScreen({ advertisements = noAdvertisements }: AuthFlowScreenProps) {
  const [state, setState] = useState<FlowState>("discovering");
  const [desktops, setDesktops] = useState<DesktopEndpoint[]>([]);
  const [selected, setSelected] = useState<DesktopEndpoint | null>(null);
  const [request, setRequest] = useState<ConnectionRequest | null>(null);
  const [deviceName, setDeviceName] = useState("My phone");
  const [error, setError] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  useEffect(() => {
    setState("ready");
    void mobileDesktopRuntime.restoreSession().then((session) => { if (session) setState("success"); }).catch(() => setState("offline"));
  }, [advertisements]);

  const scan = async () => {
    setState("discovering");
    try { const supplied = Array.from(advertisements); setDesktops(supplied.length ? mobileDesktopRuntime.discover(supplied) : await mobileDesktopRuntime.scanForDesktops()); setState("ready"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "network scan failed"); setState("error"); }
  };

  const selectDesktop = async (desktop: DesktopEndpoint) => {
    setSelected(desktop); setError(null);
    try { setRequest(await mobileDesktopRuntime.requestConnection(desktop, deviceName)); setState("confirming"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "desktop is offline"); setState("offline"); }
  };

  const complete = async () => {
    if (!request) return;
    setState("pairing"); setError(null);
    try {
      const current = await mobileDesktopRuntime.refreshConnectionRequest();
      setRequest(current);
      if (current.status !== "approved") throw new Error("Waiting for explicit desktop approval after code comparison");
      await mobileDesktopRuntime.completeApprovedConnection();
      setSettingsStatus("Paired. Local settings are ready."); setState("success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "pairing failed"); setState("confirming"); }
  };

  return <ScrollView contentContainerStyle={styles.container}>
    <Text style={styles.title}>Connect a desktop</Text>
    <Text style={styles.muted}>Scan the local network only when you request it. HTTPS certificate pinning and desktop identity checks happen before device data is sent.</Text>
    <Button title="Scan local network" onPress={() => void scan()} />
    {state === "discovering" ? <Text style={styles.muted}>Looking for desktops...</Text> : null}
    {desktops.map((desktop) => <View key={desktop.instanceId} style={styles.card}>
      <Text style={styles.name}>{desktop.displayName ?? desktop.instanceId}</Text>
      <Text style={styles.muted}>{desktop.baseUrl}</Text>
      <Button title="Select desktop" onPress={() => void selectDesktop(desktop)} />
    </View>)}
    {!desktops.length && state !== "discovering" ? <Text style={styles.muted}>No desktops found. Enable LAN access on the desktop and scan again.</Text> : null}
    {selected && state === "confirming" && request ? <View style={styles.card}>
      <Text style={styles.name}>Compare confirmation code</Text>
       <Text selectable style={styles.code}>{request.code ?? "------"}</Text>
       <Text style={styles.muted}>Compare this six-character code with the desktop, then enter it on the desktop. Matching alone never grants access.</Text>
      <TextInput value={deviceName} onChangeText={setDeviceName} placeholder="Device name" placeholderTextColor="#8993a4" style={styles.input} />
      <Button title="Check desktop approval" onPress={() => void complete()} />
    </View> : null}
    {state === "pairing" ? <Text style={styles.status}>Waiting for explicit desktop approval...</Text> : null}
    {state === "success" ? <Text style={styles.status}>Connected. {settingsStatus}</Text> : null}
    {state === "offline" ? <Text style={styles.status}>Desktop unavailable. Scan again when it is reachable.</Text> : null}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: "#101318", gap: 16 },
  title: { color: "#f5f7fa", fontSize: 28, fontWeight: "700" },
  name: { color: "#f5f7fa", fontSize: 17, fontWeight: "600", marginBottom: 6 },
  muted: { color: "#d0d7de", lineHeight: 20 },
  card: { borderColor: "#303846", borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
  input: { color: "#f5f7fa", borderColor: "#596579", borderWidth: 1, borderRadius: 6, padding: 10 },
  code: { color: "#f5f7fa", fontSize: 34, fontWeight: "700", letterSpacing: 8 },
  status: { color: "#a7f3d0" },
  error: { color: "#ffb4ab" },
});
