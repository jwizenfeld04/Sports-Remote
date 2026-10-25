# Connecting your TV

Sports Remote controls your TV over **ADB**, the debugging connection built into Android. You turn it on once in the TV's developer settings, then connect from the setup wizard (**Setup → Your TVs**). The server and the TV must be on the same home network.

- [Fire TV](#fire-tv)
- [Google TV](#google-tv)
- [Other Android TV boxes and TVs](#other-android-tv)
- [Devices that can't be used](#devices-that-cant-be-used)
- [Troubleshooting](#troubleshooting)

Before you start, give the TV a fixed address: in your router's settings, reserve its current IP address (often called a "DHCP reservation"). Otherwise the address can change and Sports Remote loses the TV.

## Fire TV

Fire TV Stick (Lite, HD, 4K, 4K Plus, 4K Max), Fire TV Cube, and smart TVs with Fire TV built in (Amazon Omni and 2/4-Series, Insignia, Toshiba, Hisense, TCL, Panasonic).

1. Open **Settings → My Fire TV → About**. On some models it's **Device** or **System** instead of My Fire TV.
2. Highlight the device name (on a Fire TV smart TV, **Your TV**) and press the center button on the remote **7 times**, until it says you're a developer. If you already see **Developer options** in the previous menu, skip this step.
3. Press Back, open **Developer options**, and turn on **ADB debugging**.
4. Find the TV's IP address under **My Fire TV → About → Network**. (Use this screen, not the main Settings → Network screen.)
5. In the wizard, choose **Fire TV**, enter the IP address and press **Connect**.
6. The TV shows **"Allow USB debugging?"**. Tick **Always allow from this computer** and choose **OK**.

The setting stays on after the TV restarts, and the connection always uses port 5555.

Some Insignia Fire TV models only show Developer options after you've signed in to an Amazon account.

## Google TV

Google TV Streamer, Chromecast with Google TV, and Google TV smart TVs (Sony, TCL, Hisense, Philips and others).

**Unlock developer options first:**

1. Open **Settings → System → About**.
2. Select **Android TV OS build** about **7 times**, until it says you're a developer.
3. Go back to **Settings → System → Developer options**.

Then follow one of these. Newer models (Google TV Streamer, and anything recently updated) have **Wireless debugging**; older ones only have **USB debugging**.

### With Wireless debugging (pair with a code)

1. In Developer options, turn on **Wireless debugging**.
2. Open **Wireless debugging → Pair device with pairing code**. Leave that screen up; it shows an IP address, a port and a six-digit code.
3. In the wizard, choose **Google TV → Pair with a code**, enter the IP address, the port and the code, and press **Pair**.
4. Sports Remote then connects on the port shown under **IP address & port** (it's a different port from the pairing one). If it can't find it by itself, it asks you to type it.

After the TV restarts, Wireless debugging may switch itself off and use a new port. Turn it back on. Sports Remote finds the new port by itself (with host networking; see [hosting](hosting.md)), or you can enter it on that TV in **Setup → Your TVs → Reconnect**.

### With USB debugging (connect directly)

1. In Developer options, turn on **USB debugging**.
2. Find the IP address under **Settings → Network & Internet → your network** (or **Settings → System → About → Status**).
3. In the wizard, choose **Google TV → Connect directly**, enter the IP address and press **Connect**.
4. The TV asks to allow debugging. Tick **Always allow from this computer** and choose **OK**.

On some Sony TVs, if the connection is refused, turning the debugging setting off and on again fixes it.

## Other Android TV

NVIDIA Shield TV, Xiaomi Mi Box and Mi TV Stick, onn. boxes and sticks, and Android TVs without the Google TV interface.

1. Open **Settings → Device Preferences → About** and select **Build** about **7 times**, until it says you're a developer.
2. Back in **Device Preferences → Developer options**, turn on **Network debugging**. Some boxes call it **USB debugging**; if you see both, turn on both.
3. Find the IP address under **Settings → Network & Internet**.
4. In the wizard, choose **Other Android TV**, enter the IP address (the port is 5555 unless the debugging screen shows another) and press **Connect**.
5. Allow the prompt on the TV, ticking **Always allow from this computer**.

If your box has **Wireless debugging** with a pairing code instead, use the Google TV steps above.

## Devices that can't be used

| Device | Why |
|---|---|
| Fire TV Stick 4K Select (2025), Fire TV Stick HD (2026), Fire TV Stick 4K (3rd gen, 2026) | They run Amazon's Vega OS, not Android, so there's no ADB. To check, look at **Settings → My Fire TV → About**: Vega devices show "OS 1.x" where others show "Fire OS". |
| Roku | Not Android; no ADB. |
| Apple TV | Not Android; no ADB. |
| Samsung TVs (Tizen) | Not Android; Samsung uses its own developer tools. |
| LG TVs (webOS) | Not Android; LG uses its own developer tools. |

If one of these is your main TV, an inexpensive Google TV or Fire TV stick plugged into it works.

## Troubleshooting

**"The TV didn't allow this server yet."** The approval prompt was missed or declined. Press Connect again and choose OK on the TV, with **Always allow** ticked.

**"The TV refused the connection."** The debugging setting is off. Check it in Developer options, or toggle it off and on. On a Google TV that refuses a direct connection, use **Pair with a code** instead.

**"Couldn't reach that address."** The TV is off, asleep, or on a different network, or the IP address changed. Check the address on the TV and that it's on the same Wi-Fi or wired network as the server.

**The TV shows "offline" after being off for a long time.** Some TVs drop the connection in deep sleep, especially on Wi-Fi. Turn the TV on; Sports Remote reconnects within a few seconds. A wired connection is more reliable.

**Another app also uses ADB** (for example a Home Assistant integration). A Fire TV accepts only one ADB connection at a time, so two tools can knock each other off. Use one at a time.

**Apps show "Not on this TV".** Install the app from the TV's app store, then press **Recheck apps** on that TV in **Setup → Your TVs**.
