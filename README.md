# Gingerbread Launcher

An Android home screen app that runs the Android 2.3.6 Gingerbread (or 2.1 Eclair) simulator from
[Android Time Machine](https://github.com/szabolevi98/android-time-machine) full screen, with the phone's real apps in it.

- It opens straight to the home screen: no boot animation and no Nexus S key row.
- It asks to be the default Home app (and the default phone app), so the phone's own home screen does not come back.
- Launcher settings (Menu on the home screen): tick which of the phone's real apps the drawer shows (hide / unhide; Files
  and Claude by default), switch between Android 2.3.6 Gingerbread and Android 2.1 Eclair, and set the default apps.
- Three Android versions from the site: 2.1, 2.3.6 and 4.0.4 (Launcher settings > Android version). For 4.0.4 the APK adds `launcher-mode.js` / `.css` to the version's page when it serves it:
  full screen without the on-screen navigation bar, the real apps and a Launcher settings entry in the app drawer,
  the phone's keys (Back, two quick Backs for Recents, holding Back for Launcher settings, Home), the lock on screen
  off, real calls from the version's Phone app, and the launcher's own call screen for real calls.
- Android 2.1 runs in launcher mode too: the real apps in All applications, the real status bar, the phone's keys
  (Back; two quick Backs for the recent apps; holding Back for Menu), the lock on screen off, and real calls on the
  2.1 in-call screen with Eclair's sliding Answer / Decline tabs.
- The app drawer has every Gingerbread app (simulated: Phone, Messaging, Camera, Maps, Market and the rest) plus the
  real Files and Claude; every other real app on the phone stays hidden.
- Files and Claude are placed on the middle home screen the first time it starts.
- The Gingerbread Camera shows the phone's real camera (Android asks once for permission); pictures appear in the
  Gingerbread Gallery and are saved to the phone's gallery under Pictures/Gingerbread.
- Calls use the Gingerbread call screen. On first start the launcher asks to be the default phone app; once it is,
  every call (made or received) shows the Gingerbread in-call screen: Dialing, the call timer, Hold, Add call, End,
  the in-call dial pad, Bluetooth, Mute and Speaker, and for incoming calls the sliding green Answer and red Decline
  tabs. Dual-SIM phones get a "Call with" list. Calls go into the Gingerbread call log as made, received or missed;
  Android still rings and keeps its own call log. The screen turns off at the ear. Numbers tapped in other apps open
  the Gingerbread dial pad.
- The Gingerbread Settings app shows and changes the phone's real settings: Wi-Fi and Bluetooth switches (directly on
  Android 9 and older), silent mode and vibrate, the four volumes, and (after "Modify system settings" is allowed)
  brightness, screen timeout, auto-rotate, haptic feedback, touch sounds and dial pad tones. Airplane mode, mobile
  data, location, NFC, the hotspot and developer options open the phone's own settings page, since Android keeps
  those for itself.
- The Gingerbread Wi-Fi settings list the networks the phone really sees (after Android asks once for location
  access, which it requires for Wi-Fi scans), show the one it is on, and connect with the password typed there
  (Android 9 and older; newer phones open their own Wi-Fi panel).
- The Market leaves out Orbit Hopper, Pixel Blocks, Lunar Golf and Pocket Planner.
- The app drawer scrolls (and flings) under your finger.
- Check boxes and radio buttons show as perfect squares and turn Gingerbread orange while pressed; touching a button
  shows no blue highlight.
- The Camera's icon strip sits right above the shutter and slider row, with its menus popping up from it.
- The status bar follows the phone: signal bars or no SIM, airplane mode, the data type (G, E, 3G, or H for
  3G+/4G/5G) with in-and-out arrows while 3G or H data moves, the Wi-Fi icon and its bars only while connected,
  Bluetooth on or connected, vibrate or silent, the battery level and charging, and the alarm icon while an alarm is
  set (on the phone or in the Gingerbread Clock, whose demo alarm starts off). Gingerbread had no roaming,
  speakerphone or muted-microphone icon to show.
- The simulator's widgets, wallpapers, live wallpapers, lock screen and notification shade all work.
- No page dots and no on-screen keys: the phone's own buttons drive it (made for the Galaxy J7 Prime 2).
  Home goes to the Gingerbread home screen, Back is the Gingerbread Back key, holding Back is the Menu key
  (a Menu key, on phones that have one, works too), two quick Back presses open the Gingerbread recent apps, and
  the Recents button stays the phone's own (Android keeps it for itself).
- Menu → Home screen → Remove items puts a delete button on home screen items.
- Turning the phone's screen off locks the Gingerbread phone: its lock screen shows when the screen comes back on.

## Get the APK

Open the [latest release](../../releases/latest) on your phone, download `GingerbreadLauncher.apk`, install it, then press
Home and pick **Gingerbread Launcher**. GitHub builds a new release on every push to `main`
(see `.github/workflows/build-apk.yml`). Every build is signed with the same key, `signing/launcher.keystore`, so a
new APK installs over the old one. Builds before build 13 each had a different key: uninstall one of those first.

## Layout

- `app/src/main/assets/site/`: the simulator files (`versions/2.3.6`, `versions/2.1`, the shared scripts such as
  `launcher-apk.js`, and audio).
- `app/src/main/java/net/gingerbread/launcher/MainActivity.java`: the WebView and the `window.AndroidLauncher` bridge.

## License

The simulator is licensed under the GNU AGPL v3 (see `LICENSE` and `THIRD_PARTY_NOTICES.md`); this app is distributed
under the same license, with its full source in this repository.
