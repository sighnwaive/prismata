import React, { useEffect, useState } from "react";
import {
  AppState,
  Button,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from "react-native-vision-camera";
import {
  getScannerPresentation,
  type ScannerPermission,
} from "./scanner-state";

export type QrScannerScreenProps = {
  onScanned: (value: string) => void;
  onCancel: () => void;
};

export default function QrScannerScreen({
  onScanned,
  onCancel,
}: QrScannerScreenProps) {
  const device = useCameraDevice("back");
  const [permission, setPermission] = useState<ScannerPermission>("checking");
  const [handled, setHandled] = useState(false);
  const [permissionAttempt, setPermissionAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    const refreshPermission = async () => {
      try {
        const current = String(Camera.getCameraPermissionStatus());
        if (current === "granted" || current === "authorized") {
          if (active) setPermission("granted");
          return;
        }
        if (current === "not-determined") {
          await Camera.requestCameraPermission();
          const afterRequest = String(Camera.getCameraPermissionStatus());
          if (active)
            setPermission(
              afterRequest === "granted" || afterRequest === "authorized"
                ? "granted"
                : "denied"
            );
          return;
        }
        if (active) setPermission("denied");
      } catch {
        if (active) setPermission("unavailable");
      }
    };

    void refreshPermission();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPermission();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [permissionAttempt]);

  const codeScanner = useCodeScanner({
    codeTypes: ["qr"],
    onCodeScanned: (codes) => {
      const value = codes[0]?.value;
      if (value && !handled) {
        setHandled(true);
        onScanned(value);
      }
    },
  });

  const presentation = getScannerPresentation(permission, !!device, handled);
  if (presentation === "checking")
    return <Fallback title="Starting camera…" onCancel={onCancel} />;
  if (presentation === "permission")
    return (
      <Fallback
        title="Camera permission is required to scan QR codes."
        actionTitle="Open settings"
        onAction={() => void Linking.openSettings()}
        onCancel={onCancel}
      />
    );
  if (presentation === "unavailable")
    return (
      <Fallback
        title="No camera is available on this device."
        actionTitle="Try again"
        onAction={() => {
          setPermission("checking");
          setPermissionAttempt((attempt) => attempt + 1);
        }}
        onCancel={onCancel}
      />
    );
  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device!}
        isActive={!handled}
        codeScanner={codeScanner}
      />
      <View style={styles.controls}>
        <Text style={styles.help}>
          {handled
            ? "QR detected, validating…"
            : "Point the camera at the Prismata pairing QR."}
        </Text>
        <Button title="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

function Fallback({
  title,
  actionTitle,
  onAction,
  onCancel,
}: {
  title: string;
  actionTitle?: string;
  onAction?: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.help}>
        Use manual HTTPS pairing instead. No credentials are stored in the QR
        challenge.
      </Text>
      {actionTitle && onAction ? (
        <Button title={actionTitle} onPress={onAction} />
      ) : null}
      <Button title="Use manual pairing" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#101318" },
  controls: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    padding: 24,
    gap: 12,
    backgroundColor: "#101318dd",
  },
  fallback: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 16,
    backgroundColor: "#101318",
  },
  title: { color: "#f5f7fa", fontSize: 22, fontWeight: "700" },
  help: { color: "#d0d7de", lineHeight: 20 },
});
