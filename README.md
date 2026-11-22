# Gingerbread Launcher

An Android home screen app that runs the Android 2.3.6 Gingerbread simulator from
[Android Time Machine](https://github.com/szabolevi98/android-time-machine) full screen, with the phone's real apps in it.

- The app drawer lists the apps installed on your phone, and tapping one opens it.
- Files and Claude are placed on the middle home screen the first time it starts.
- The dock's phone and globe buttons open your real dialer and browser.
- The simulator's widgets, wallpapers, live wallpapers, lock screen and notification shade all work.
- Extras: a floating Back / Home / Recents bar, page dots, and Menu → Home screen → Remove items to delete items.
- The phone's Back and Home buttons control the simulator.

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
