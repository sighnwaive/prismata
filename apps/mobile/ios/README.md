# iOS native configuration

The iOS Xcode project is not checked in yet. When it is generated, add these keys to the application target's `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Prismata uses the camera to scan a desktop pairing QR code.</string>
<key>NSLocalNetworkUsageDescription</key>
<string>Prismata discovers paired desktops on your local network.</string>
<key>NSBonjourServices</key>
<array>
  <string>_prismata._tcp</string>
</array>
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>prismata</string>
    </array>
  </dict>
</array>
```

Use an iOS Bonjour/DNS-SD implementation for `_prismata._tcp` when the Xcode target is added, and run `pod install` after adding `react-native-vision-camera` and that implementation. The app still exposes HTTPS manual pairing when camera or local-network access is denied or unavailable. Discovery is convenience only; HTTPS identity verification and pairing remain authoritative.
