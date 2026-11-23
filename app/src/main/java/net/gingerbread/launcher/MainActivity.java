package net.gingerbread.launcher;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlarmManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothProfile;
import android.media.AudioManager;
import android.net.TrafficStats;
import android.net.wifi.WifiManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.telephony.PhoneStateListener;
import android.telephony.SignalStrength;
import android.telephony.TelephonyManager;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.List;

/**
 * A home screen app that runs the Android 2.3.6 Gingerbread simulator (bundled in assets/site) full screen.
 * The page reads the phone's real apps through window.AndroidLauncher and opens them with it.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/site/versions/2.3.6/index.html";
    private static final int ICON_PX = 96;

    private static final int CAMERA_REQUEST = 7;
    private static final int CALL_REQUEST = 9;
    // A number waiting for Android's call permission prompt.
    private String pendingCall;

    private WebView web;
    private BroadcastReceiver packageReceiver;
    // Wi-Fi networks the phone is connected to right now (normally zero or one).
    private final java.util.Set<Network> wifiNetworks = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
    private ConnectivityManager.NetworkCallback wifiCallback;
    // Mobile data networks in use right now, the signal bars (0-4) and the phone listener that reports them.
    private final java.util.Set<Network> cellNetworks = java.util.Collections.synchronizedSet(new java.util.HashSet<>());
    private ConnectivityManager.NetworkCallback cellCallback;
    private PhoneStateListener signalListener;
    private volatile int signalLevel = 4;
    private final android.os.Handler keys = new android.os.Handler(android.os.Looper.getMainLooper());
    // Mobile data moving (bytes in or out during the last second), checked while the launcher is on screen.
    private volatile boolean dataActive;
    private long lastMobileBytes = -1;
    private final Runnable trafficCheck = new Runnable() {
        @Override
        public void run() {
            long bytes = TrafficStats.getMobileRxBytes() + TrafficStats.getMobileTxBytes();
            boolean active = !cellNetworks.isEmpty() && lastMobileBytes >= 0 && bytes > lastMobileBytes;
            lastMobileBytes = bytes;
            if (active != dataActive) { dataActive = active; tellPagePhone(); }
            keys.postDelayed(this, 1000);
        }
    };
    // Battery level and charging, and whether a real alarm is set, for the page's status bar.
    private BroadcastReceiver statusReceiver;
    private volatile int batteryLevel = 100;
    private volatile boolean batteryCharging;
    // The page's camera request, held while Android asks for the camera permission.
    private PermissionRequest pendingCamera;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideStatusBar();

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Bridge(), "AndroidLauncher");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // Real web links leave the simulator and open in the phone's browser.
                startSafely(new Intent(Intent.ACTION_VIEW, url));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleCameraRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (request == pendingCamera) pendingCamera = null;
            }
        });
        setContentView(web);
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);

        // Reload the app list when an app is installed, updated or removed.
        packageReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                web.evaluateJavascript("window.gbRealAppsChanged && window.gbRealAppsChanged()", null);
            }
        };
        watchWifi();
        watchBatteryAndAlarm();
        watchPhone();

        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_PACKAGE_ADDED);
        filter.addAction(Intent.ACTION_PACKAGE_REMOVED);
        filter.addAction(Intent.ACTION_PACKAGE_CHANGED);
        filter.addDataScheme("package");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(packageReceiver, filter, Context.RECEIVER_EXPORTED);
        else registerReceiver(packageReceiver, filter);
    }

    private void readBattery(Intent battery) {
        if (battery == null) return;
        int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        if (level >= 0 && scale > 0) batteryLevel = Math.round(level * 100f / scale);
        int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        batteryCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL && battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
    }

    private boolean alarmSet() {
        AlarmManager alarms = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        return alarms != null && alarms.getNextAlarmClock() != null;
    }

    // The battery icon follows the real battery as it drains and charges; the alarm icon shows while an alarm is set.
    private void watchBatteryAndAlarm() {
        statusReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())) {
                    readBattery(intent);
                    if (web != null) web.evaluateJavascript("window.gbRealBattery && window.gbRealBattery(" + batteryLevel + "," + batteryCharging + ")", null);
                } else if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                    // The screen went off: lock the Gingerbread phone so its lock screen shows when it comes back on.
                    if (web != null) web.evaluateJavascript("window.gbLockNow && window.gbLockNow()", null);
                } else if (!AlarmManager.ACTION_NEXT_ALARM_CLOCK_CHANGED.equals(intent.getAction())) {
                    tellPagePhone(); // airplane mode, Wi-Fi strength, ringer or Bluetooth changed
                } else if (web != null) {
                    web.evaluateJavascript("window.gbRealAlarm && window.gbRealAlarm(" + alarmSet() + ")", null);
                }
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        filter.addAction(AlarmManager.ACTION_NEXT_ALARM_CLOCK_CHANGED);
        filter.addAction(Intent.ACTION_AIRPLANE_MODE_CHANGED);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(WifiManager.RSSI_CHANGED_ACTION);
        filter.addAction(AudioManager.RINGER_MODE_CHANGED_ACTION);
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_CONNECTION_STATE_CHANGED);
        Intent sticky = Build.VERSION.SDK_INT >= 33 ? registerReceiver(statusReceiver, filter, Context.RECEIVER_EXPORTED) : registerReceiver(statusReceiver, filter);
        readBattery(sticky);
    }

    // The Gingerbread data icon for the network mobile data is using: G, E, 3G or H (4G/LTE and 5G show as H,
    // the fastest icon Gingerbread had). Android 10 and older tell any app; Android 11+ needs the phone permission.
    @SuppressWarnings("deprecation")
    private String dataType() {
        if (cellNetworks.isEmpty()) return "";
        TelephonyManager tm = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
        int type = TelephonyManager.NETWORK_TYPE_UNKNOWN;
        try {
            if (tm != null) type = Build.VERSION.SDK_INT >= 30 ? tm.getDataNetworkType() : tm.getNetworkType();
        } catch (SecurityException e) {
            type = TelephonyManager.NETWORK_TYPE_UNKNOWN;
        }
        switch (type) {
            case TelephonyManager.NETWORK_TYPE_GPRS: case TelephonyManager.NETWORK_TYPE_CDMA: case TelephonyManager.NETWORK_TYPE_1xRTT: case TelephonyManager.NETWORK_TYPE_IDEN: case TelephonyManager.NETWORK_TYPE_GSM:
                return "g";
            case TelephonyManager.NETWORK_TYPE_EDGE:
                return "e";
            case TelephonyManager.NETWORK_TYPE_UMTS: case TelephonyManager.NETWORK_TYPE_EVDO_0: case TelephonyManager.NETWORK_TYPE_EVDO_A: case TelephonyManager.NETWORK_TYPE_EVDO_B: case TelephonyManager.NETWORK_TYPE_EHRPD: case TelephonyManager.NETWORK_TYPE_TD_SCDMA:
                return "3g";
            default:
                return "h";
        }
    }

    private boolean noSim() {
        TelephonyManager tm = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
        return tm == null || tm.getSimState() == TelephonyManager.SIM_STATE_ABSENT;
    }

    private boolean airplaneMode() {
        return Settings.Global.getInt(getContentResolver(), Settings.Global.AIRPLANE_MODE_ON, 0) != 0;
    }

    @SuppressWarnings("deprecation")
    private int wifiLevel() {
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null || wm.getConnectionInfo() == null) return 4;
            return Math.max(0, Math.min(4, WifiManager.calculateSignalLevel(wm.getConnectionInfo().getRssi(), 5)));
        } catch (RuntimeException e) {
            return 4;
        }
    }

    private String ringer() {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return "";
        int mode = audio.getRingerMode();
        return mode == AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : mode == AudioManager.RINGER_MODE_SILENT ? "silent" : "";
    }

    // {on, connected}: Bluetooth switched on, and a headset or speaker connected.
    @SuppressWarnings("MissingPermission")
    private boolean[] bluetooth() {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) return new boolean[]{false, false};
            boolean connected = adapter.getProfileConnectionState(BluetoothProfile.A2DP) == BluetoothProfile.STATE_CONNECTED
                    || adapter.getProfileConnectionState(BluetoothProfile.HEADSET) == BluetoothProfile.STATE_CONNECTED;
            return new boolean[]{true, connected};
        } catch (SecurityException e) {
            return new boolean[]{false, false};
        }
    }

    private String phoneJson() {
        boolean[] bt = bluetooth();
        return "{\"signal\":" + signalLevel + ",\"data\":\"" + dataType() + "\",\"dataActive\":" + dataActive + ",\"noSim\":" + noSim()
                + ",\"airplane\":" + airplaneMode() + ",\"wifiLevel\":" + wifiLevel() + ",\"ringer\":\"" + ringer() + "\",\"bluetooth\":" + bt[0]
                + ",\"bluetoothConnected\":" + bt[1] + "}";
    }

    private void tellPagePhone() {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript("window.gbRealPhone && window.gbRealPhone(" + phoneJson() + ")", null); });
    }

    // Signal bars from the phone's signal strength, mobile data use, and airplane mode changes.
    @SuppressWarnings("deprecation")
    private void watchPhone() {
        TelephonyManager tm = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
        if (tm != null) {
            signalListener = new PhoneStateListener() {
                @Override
                public void onSignalStrengthsChanged(SignalStrength strength) {
                    signalLevel = Math.max(0, Math.min(4, strength.getLevel()));
                    tellPagePhone();
                }

                @Override
                public void onDataConnectionStateChanged(int state, int networkType) {
                    tellPagePhone();
                }
            };
            try {
                tm.listen(signalListener, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS | PhoneStateListener.LISTEN_DATA_CONNECTION_STATE);
            } catch (SecurityException e) {
                try { tm.listen(signalListener, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS); } catch (SecurityException ignored) { signalListener = null; }
            }
        }
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        cellCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                cellNetworks.add(network);
                tellPagePhone();
            }

            @Override
            public void onLost(Network network) {
                cellNetworks.remove(network);
                tellPagePhone();
            }
        };
        try {
            cm.registerNetworkCallback(new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), cellCallback);
        } catch (RuntimeException e) {
            cellCallback = null;
        }
    }

    private boolean wifiConnected() {
        return !wifiNetworks.isEmpty();
    }

    private void tellPageWifi() {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript("window.gbRealWifi && window.gbRealWifi(" + wifiConnected() + ")", null); });
    }

    // Follows the phone's Wi-Fi: the page's status bar shows the Wi-Fi icon only while it is connected.
    private void watchWifi() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        wifiCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                wifiNetworks.add(network);
                tellPageWifi();
            }

            @Override
            public void onLost(Network network) {
                wifiNetworks.remove(network);
                tellPageWifi();
            }
        };
        try {
            cm.registerNetworkCallback(new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), wifiCallback);
        } catch (RuntimeException e) {
            wifiCallback = null;
        }
        // The state right now, before the first callback arrives.
        for (Network network : cm.getAllNetworks()) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) wifiNetworks.add(network);
        }
    }

    // Only the camera is ever granted to the page, and only after Android's own permission prompt.
    private void handleCameraRequest(PermissionRequest request) {
        boolean wantsCamera = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsCamera = true;
        }
        if (!wantsCamera) { request.deny(); return; }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            return;
        }
        if (pendingCamera != null) pendingCamera.deny();
        pendingCamera = request;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
    }

    // Calls the number straight away once the call permission is allowed; otherwise opens the phone's dialer with it.
    private void placeCall(String number) {
        String digits = number == null ? "" : number.replaceAll("[^0-9+*#,;]", "");
        if (digits.isEmpty()) return;
        Uri tel = Uri.fromParts("tel", digits, null);
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) {
            startSafely(new Intent(Intent.ACTION_CALL, tel));
            return;
        }
        pendingCall = digits;
        requestPermissions(new String[]{Manifest.permission.CALL_PHONE}, CALL_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CALL_REQUEST) {
            String number = pendingCall;
            pendingCall = null;
            if (number == null) return;
            Uri tel = Uri.fromParts("tel", number, null);
            boolean allowed = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            startSafely(new Intent(allowed ? Intent.ACTION_CALL : Intent.ACTION_DIAL, tel));
            return;
        }
        if (requestCode != CAMERA_REQUEST || pendingCamera == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingCamera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingCamera.deny();
            Toast.makeText(this, "Camera permission is needed for the live camera", Toast.LENGTH_LONG).show();
        }
        pendingCamera = null;
    }

    // Leaving the launcher releases the camera; coming back lets the Camera app take it again.
    @Override
    protected void onPause() {
        keys.removeCallbacks(trafficCheck);
        if (web != null) web.evaluateJavascript("window.gbOnPause && window.gbOnPause()", null);
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.gbOnResume && window.gbOnResume()", null);
        tellPageWifi();
        tellPagePhone();
        lastMobileBytes = -1;
        keys.removeCallbacks(trafficCheck);
        keys.post(trafficCheck);
        if (web != null) web.evaluateJavascript("window.gbRealAlarm && window.gbRealAlarm(" + alarmSet() + ")", null);
    }

    // A JPEG from the Gingerbread Camera into the phone's gallery (Pictures/Gingerbread).
    private boolean savePicture(byte[] jpeg) {
        String name = "IMG_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".jpg";
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver resolver = getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Gingerbread");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return false;
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) return false;
                    out.write(jpeg);
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                return true;
            }
            // Android 9 and older: ask once for storage, then write the file and announce it to the gallery.
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, CAMERA_REQUEST + 1));
                return false;
            }
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Gingerbread");
            if (!dir.exists() && !dir.mkdirs()) return false;
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(jpeg);
            }
            sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(file)));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void hideStatusBar() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(true);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideStatusBar();
    }

    // The phone's Home button while the launcher is already open: go to the simulator's home screen.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (web != null) web.evaluateJavascript("(function(){var k=document.querySelector('.touch-home');if(k&&!k.disabled)k.click();})()", null);
    }

    /* The phone's own keys drive the simulator (a Galaxy J7 Prime 2 has Recents, Home and Back, and no Menu key):
       a tap on Back is the Gingerbread Back key, holding Back is the Gingerbread Menu key, and a Menu key, where a
       phone has one, is Menu too. Recents stays the phone's own. A launcher never closes itself on Back. */
    private boolean backHeld;
    // Two quick Back presses open the Gingerbread recent apps, so a single Back waits this long for a second one.
    private static final long DOUBLE_BACK_MS = 300;
    private boolean backWaiting;
    private final Runnable singleBack = () -> { backWaiting = false; pressKey(".touch-back"); };

    private void openRecents() {
        if (web != null) web.evaluateJavascript("(function(){var s=document.querySelector('#screen');if(!s)return;var b=document.createElement('button');b.hidden=true;b.dataset.action='recent';s.appendChild(b);b.click();b.remove();})()", null);
    }

    private void backTapped() {
        if (backWaiting) {
            keys.removeCallbacks(singleBack);
            backWaiting = false;
            openRecents();
            return;
        }
        backWaiting = true;
        keys.postDelayed(singleBack, DOUBLE_BACK_MS);
    }

    private void pressKey(String selector) {
        if (web != null) web.evaluateJavascript("(function(){var k=document.querySelector('" + selector + "');if(k&&!k.disabled)k.click();})()", null);
    }

    // Back and Menu come here before the WebView, so a page that is focused cannot swallow them.
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_MENU) {
            return event.dispatch(this, getWindow().getDecorView().getKeyDispatcherState(), this);
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.getRepeatCount() == 0) { backHeld = false; event.startTracking(); }
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MENU) return true;
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            backHeld = true;
            pressKey(".touch-menu");
            if (web != null) web.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (!backHeld && !event.isCanceled()) backTapped();
            backHeld = false;
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            pressKey(".touch-menu");
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        backTapped();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (packageReceiver != null) unregisterReceiver(packageReceiver);
        if (statusReceiver != null) unregisterReceiver(statusReceiver);
        if (signalListener != null) {
            TelephonyManager tm = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null) tm.listen(signalListener, PhoneStateListener.LISTEN_NONE);
        }
        if (cellCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            try { if (cm != null) cm.unregisterNetworkCallback(cellCallback); } catch (RuntimeException ignored) { }
        }
        if (wifiCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            try { if (cm != null) cm.unregisterNetworkCallback(wifiCallback); } catch (RuntimeException ignored) { }
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private void startSafely(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(this, "App not found", Toast.LENGTH_SHORT).show();
        }
    }

    private static String iconData(Drawable drawable) {
        Bitmap bitmap = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, ICON_PX, ICON_PX);
        drawable.draw(canvas);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        bitmap.recycle();
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /** window.AndroidLauncher in the page. Methods run on a background thread. */
    private class Bridge {
        @JavascriptInterface
        public String apps() {
            PackageManager pm = getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> found = pm.queryIntentActivities(main, 0);
            JSONArray list = new JSONArray();
            for (ResolveInfo info : found) {
                String pkg = info.activityInfo.packageName;
                if (pkg.equals(getPackageName())) continue;
                try {
                    JSONObject app = new JSONObject();
                    app.put("id", "real:" + pkg + "/" + info.activityInfo.name);
                    app.put("label", String.valueOf(info.loadLabel(pm)));
                    app.put("icon", iconData(info.loadIcon(pm)));
                    list.put(app);
                } catch (Exception ignored) {
                    // Skip an app whose label or icon cannot be read.
                }
            }
            return list.toString();
        }

        @JavascriptInterface
        public void launch(String component) {
            runOnUiThread(() -> {
                ComponentName name = ComponentName.unflattenFromString(component);
                if (name == null) return;
                Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(name);
                intent.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                startSafely(intent);
            });
        }

        @JavascriptInterface
        public String battery() {
            return "{\"level\":" + batteryLevel + ",\"charging\":" + batteryCharging + "}";
        }

        @JavascriptInterface
        public String phone() {
            return phoneJson();
        }

        @JavascriptInterface
        public boolean alarmSet() {
            return MainActivity.this.alarmSet();
        }

        @JavascriptInterface
        public boolean wifiConnected() {
            return MainActivity.this.wifiConnected();
        }

        @JavascriptInterface
        public boolean savePhoto(String dataUrl) {
            int comma = dataUrl == null ? -1 : dataUrl.indexOf(',');
            if (comma < 0 || !dataUrl.startsWith("data:image/jpeg;base64")) return false;
            try {
                return savePicture(Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT));
            } catch (IllegalArgumentException e) {
                return false;
            }
        }

        @JavascriptInterface
        public void call(String number) {
            runOnUiThread(() -> placeCall(number));
        }

        @JavascriptInterface
        public void openDialer() {
            runOnUiThread(() -> startSafely(new Intent(Intent.ACTION_DIAL)));
        }

        @JavascriptInterface
        public void openBrowser() {
            runOnUiThread(() -> startSafely(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)));
        }
    }
}
