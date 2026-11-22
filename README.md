# Gingerbread Launcher

An Android home screen app that runs the Android 2.3.6 Gingerbread simulator from
[Android Time Machine](https://github.com/szabolevi98/android-time-machine) full screen, with the phone's real apps in it.

- It opens straight to the home screen: no boot animation and no Nexus S key row.
- The app drawer has every Gingerbread app (simulated: Phone, Messaging, Camera, Maps, Market and the rest) plus the
  real Files and Claude; every other real app on the phone stays hidden.
- Files and Claude are placed on the middle home screen the first time it starts.
- The Gingerbread Camera shows the phone's real camera (Android asks once for permission); pictures appear in the
  Gingerbread Gallery and are saved to the phone's gallery under Pictures/Gingerbread.
- The Market leaves out Orbit Hopper and Pixel Blocks.
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

## Get the APK

Open the [latest release](../../releases/latest) on your phone, download `GingerbreadLauncher.apk`, install it, then press
Home and pick **Gingerbread Launcher**. GitHub builds a new release on every push to `main`
(see `.github/workflows/build-apk.yml`).

## Layout

- `app/src/main/assets/site/`: the simulator files (`versions/2.3.6` plus the shared scripts and audio).
- `app/src/main/java/net/gingerbread/launcher/MainActivity.java`: the WebView and the `window.AndroidLauncher` bridge.

## License

The simulator is licensed under the GNU AGPL v3 (see `LICENSE` and `THIRD_PARTY_NOTICES.md`); this app is distributed
under the same license, with its full source in this repository.
