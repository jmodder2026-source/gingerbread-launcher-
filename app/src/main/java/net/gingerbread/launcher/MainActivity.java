package net.gingerbread.launcher;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlarmManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothProfile;
import android.app.NotificationManager;
import android.location.LocationManager;
import android.media.AudioManager;
import android.nfc.NfcAdapter;
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
import android.telecom.TelecomManager;
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
    /** Set on the intent CallService uses to bring the call screen up. */
    static final String EXTRA_CALL = "gb_call";
    private static final int DIALER_REQUEST = 13;
    private android.os.PowerManager.WakeLock proximityLock;
    private boolean askedDialer;
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/site/versions/2.3.6/index.html";
    private static final int ICON_PX = 96;

    private static final int CAMERA_REQUEST = 7;
    private static final int CALL_REQUEST = 9;
    private static final int WIFI_SCAN_REQUEST = 11;
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
            public void onPageFinished(WebView view, String url) {
                CallService.reportAll();
                handleDialIntent(getIntent());
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
        CallService.sink = this::onCallReport;
        offerDefaultDialer();
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
                } else if (WifiManager.SCAN_RESULTS_AVAILABLE_ACTION.equals(intent.getAction())
                        || WifiManager.NETWORK_STATE_CHANGED_ACTION.equals(intent.getAction())
                        || WifiManager.WIFI_STATE_CHANGED_ACTION.equals(intent.getAction())) {
                    tellPageWifiList(); // new scan results, or the phone joined, left or switched Wi-Fi
                    tellPagePhone();
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
        filter.addAction(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION);
        filter.addAction(WifiManager.NETWORK_STATE_CHANGED_ACTION);
        filter.addAction(WifiManager.WIFI_STATE_CHANGED_ACTION);
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

    // ---- The Gingerbread Settings app: the phone's real settings ----------------------------------------------------

    private int volumePercent(AudioManager audio, int stream) {
        int max = audio.getStreamMaxVolume(stream);
        return max > 0 ? Math.round(audio.getStreamVolume(stream) * 100f / max) : 0;
    }

    private int systemInt(String name, int fallback) {
        try { return Settings.System.getInt(getContentResolver(), name); } catch (Exception e) { return fallback; }
    }

    // Gingerbread's screen timeout choices: 15 s, 30 s, 1, 2, 10 and 30 min, then "Never".
    private static final int[] TIMEOUTS = {15000, 30000, 60000, 120000, 600000, 1800000, Integer.MAX_VALUE};

    @SuppressWarnings({"deprecation", "MissingPermission"})
    private String settingsJson() {
        org.json.JSONObject o = new org.json.JSONObject();
        try {
            o.put("airplane", airplaneMode());
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) o.put("wifi", wm.isWifiEnabled());
            o.put("bluetooth", bluetooth()[0]);
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                o.put("gps", lm.isProviderEnabled(LocationManager.GPS_PROVIDER));
                o.put("networkLocation", lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
            }
            try { NfcAdapter nfc = NfcAdapter.getDefaultAdapter(this); if (nfc != null) o.put("nfc", nfc.isEnabled()); } catch (Exception ignored) { }
            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audio != null) {
                int mode = audio.getRingerMode();
                o.put("silent", mode != AudioManager.RINGER_MODE_NORMAL);
                o.put("vibrate", mode == AudioManager.RINGER_MODE_VIBRATE);
                o.put("ringVolume", volumePercent(audio, AudioManager.STREAM_RING));
                o.put("mediaVolume", volumePercent(audio, AudioManager.STREAM_MUSIC));
                o.put("alarmVolume", volumePercent(audio, AudioManager.STREAM_ALARM));
                o.put("notificationVolume", volumePercent(audio, AudioManager.STREAM_NOTIFICATION));
            }
            o.put("brightness", Math.round(systemInt(Settings.System.SCREEN_BRIGHTNESS, 128) * 100f / 255));
            o.put("autoBrightness", systemInt(Settings.System.SCREEN_BRIGHTNESS_MODE, 0) == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC);
            int timeout = systemInt(Settings.System.SCREEN_OFF_TIMEOUT, 30000), index = TIMEOUTS.length - 1;
            for (int i = 0; i < TIMEOUTS.length; i++) if (timeout <= TIMEOUTS[i]) { index = i; break; }
            o.put("screenTimeout", index);
            o.put("rotate", systemInt(Settings.System.ACCELEROMETER_ROTATION, 0) == 1);
            o.put("haptic", systemInt(Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) == 1);
            o.put("soundEffects", systemInt(Settings.System.SOUND_EFFECTS_ENABLED, 1) == 1);
            o.put("dtmfTone", systemInt(Settings.System.DTMF_TONE_WHEN_DIALING, 1) == 1);
        } catch (Exception ignored) {
            // Report what could be read.
        }
        return o.toString();
    }

    private String openSettings(String action) {
        Intent intent = new Intent(action);
        if (Settings.ACTION_MANAGE_WRITE_SETTINGS.equals(action) || "android.settings.MANAGE_UNKNOWN_APP_SOURCES".equals(action)) {
            intent.setData(Uri.parse("package:" + getPackageName()));
        }
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return "opened";
        } catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return "opened"; } catch (Exception ignored) { return "no"; }
        }
    }

    // Writes a system setting once "Modify system settings" is allowed; otherwise opens that permission page.
    private String writeSystem(String name, int value) {
        if (!Settings.System.canWrite(this)) return openSettings(Settings.ACTION_MANAGE_WRITE_SETTINGS);
        try {
            Settings.System.putInt(getContentResolver(), name, value);
            return "ok";
        } catch (Exception e) {
            return "no";
        }
    }

    private String setVolume(int stream, String percent) {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return "no";
        try {
            int max = audio.getStreamMaxVolume(stream);
            audio.setStreamVolume(stream, Math.round(Float.parseFloat(percent) * max / 100f), 0);
            return "ok";
        } catch (Exception e) {
            return "no";
        }
    }

    // Normal, vibrate or silent. Silent needs Do Not Disturb access on Android 7+: without it the phone vibrates and
    // the access page opens.
    private String setRinger(String mode) {
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return "no";
        int wanted = "silent".equals(mode) ? AudioManager.RINGER_MODE_SILENT : "vibrate".equals(mode) ? AudioManager.RINGER_MODE_VIBRATE : AudioManager.RINGER_MODE_NORMAL;
        try {
            audio.setRingerMode(wanted);
            return "ok";
        } catch (SecurityException e) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (wanted == AudioManager.RINGER_MODE_SILENT) {
                try { audio.setRingerMode(AudioManager.RINGER_MODE_VIBRATE); } catch (SecurityException ignored) { }
            }
            if (nm != null && !nm.isNotificationPolicyAccessGranted()) return openSettings(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
            return "no";
        }
    }

    @SuppressWarnings({"deprecation", "MissingPermission"})
    private String setSetting(String key, String value) {
        boolean on = "true".equals(value);
        switch (key) {
            case "wifi":
                if (Build.VERSION.SDK_INT < 29) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    try { if (wm != null && wm.setWifiEnabled(on)) return "ok"; } catch (SecurityException ignored) { }
                }
                return openSettings(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS);
            case "bluetooth":
                try {
                    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                    if (adapter != null && Build.VERSION.SDK_INT < 33 && (on ? adapter.enable() : adapter.disable())) return "ok";
                } catch (SecurityException ignored) { }
                return openSettings(Settings.ACTION_BLUETOOTH_SETTINGS);
            case "bluetoothVisible":
                if (!on) return "ok";
                return startDiscoverable();
            case "airplane":
                return openSettings(Settings.ACTION_AIRPLANE_MODE_SETTINGS);
            case "dataEnabled": case "dataRoaming":
                return openSettings(Settings.ACTION_DATA_ROAMING_SETTINGS);
            case "gps": case "networkLocation": case "assistedGps":
                return openSettings(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            case "nfc":
                return openSettings(Settings.ACTION_NFC_SETTINGS);
            case "portableHotspot":
                return openSettings(Settings.ACTION_WIRELESS_SETTINGS);
            case "usbDebug": case "stayAwake": case "mockLocations":
                return openSettings(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
            case "unknownSources":
                return openSettings(Build.VERSION.SDK_INT >= 26 ? "android.settings.MANAGE_UNKNOWN_APP_SOURCES" : Settings.ACTION_SECURITY_SETTINGS);
            case "ringer":
                return setRinger(value);
            case "ringVolume": return setVolume(AudioManager.STREAM_RING, value);
            case "mediaVolume": return setVolume(AudioManager.STREAM_MUSIC, value);
            case "alarmVolume": return setVolume(AudioManager.STREAM_ALARM, value);
            case "notificationVolume": return setVolume(AudioManager.STREAM_NOTIFICATION, value);
            case "brightness": {
                int level = Math.max(1, Math.min(255, Math.round(Float.parseFloat(value) * 255f / 100f)));
                // Until "Modify system settings" is allowed, at least the launcher's own screen takes the brightness.
                boolean system = Settings.System.canWrite(this);
                android.view.WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = system ? -1f : level / 255f;
                getWindow().setAttributes(lp);
                return writeSystem(Settings.System.SCREEN_BRIGHTNESS, level);
            }
            case "autoBrightness":
                return writeSystem(Settings.System.SCREEN_BRIGHTNESS_MODE, on ? Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC : Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            case "screenTimeout": {
                int index = Math.max(0, Math.min(TIMEOUTS.length - 1, (int) Float.parseFloat(value)));
                return writeSystem(Settings.System.SCREEN_OFF_TIMEOUT, TIMEOUTS[index]);
            }
            case "rotate": return writeSystem(Settings.System.ACCELEROMETER_ROTATION, on ? 1 : 0);
            case "haptic": return writeSystem(Settings.System.HAPTIC_FEEDBACK_ENABLED, on ? 1 : 0);
            case "soundEffects": return writeSystem(Settings.System.SOUND_EFFECTS_ENABLED, on ? 1 : 0);
            case "dtmfTone": return writeSystem(Settings.System.DTMF_TONE_WHEN_DIALING, on ? 1 : 0);
            default:
                return "no";
        }
    }

    private String startDiscoverable() {
        try {
            startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return "opened";
        } catch (Exception e) {
            return openSettings(Settings.ACTION_BLUETOOTH_SETTINGS);
        }
    }

    // ---- The Gingerbread Wi-Fi settings: the networks the phone really sees -------------------------------------------

    private WifiManager wifi() {
        return (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    private boolean locationAllowed() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void tellPageWifiList() {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript("window.gbRealWifiNetworks && window.gbRealWifiNetworks()", null); });
    }

    // Starts a scan; the results arrive with SCAN_RESULTS_AVAILABLE_ACTION. Asks for location access the first time.
    @SuppressWarnings("deprecation")
    private String wifiScan() {
        if (!locationAllowed()) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, WIFI_SCAN_REQUEST);
            return "asking";
        }
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        boolean locationOn = lm == null || Build.VERSION.SDK_INT < 28 || lm.isLocationEnabled();
        WifiManager wm = wifi();
        try { if (wm != null) wm.startScan(); } catch (Exception ignored) { }
        return locationOn ? "ok" : "location-off";
    }

    private static String security(String capabilities) {
        if (capabilities == null) return "Open";
        if (capabilities.contains("WPA2") || capabilities.contains("RSN") || capabilities.contains("SAE")) return "WPA2";
        if (capabilities.contains("WPA")) return "WPA";
        if (capabilities.contains("WEP")) return "WEP";
        return "Open";
    }

    // The scan results, one row per network name (the strongest access point), strongest first.
    @SuppressWarnings("deprecation")
    private String wifiNetworksJson() {
        JSONArray list = new JSONArray();
        WifiManager wm = wifi();
        if (wm == null || !locationAllowed()) return list.toString();
        java.util.Map<String, android.net.wifi.ScanResult> best = new java.util.LinkedHashMap<>();
        try {
            for (android.net.wifi.ScanResult result : wm.getScanResults()) {
                if (result.SSID == null || result.SSID.isEmpty()) continue;
                android.net.wifi.ScanResult seen = best.get(result.SSID);
                if (seen == null || result.level > seen.level) best.put(result.SSID, result);
            }
        } catch (SecurityException e) {
            return list.toString();
        }
        java.util.List<android.net.wifi.ScanResult> sorted = new java.util.ArrayList<>(best.values());
        sorted.sort((a, b) -> b.level - a.level);
        for (android.net.wifi.ScanResult result : sorted) {
            try {
                JSONObject row = new JSONObject();
                row.put("name", result.SSID);
                row.put("security", security(result.capabilities));
                row.put("strength", Math.max(0, Math.min(4, WifiManager.calculateSignalLevel(result.level, 5))));
                list.put(row);
            } catch (Exception ignored) { }
        }
        return list.toString();
    }

    @SuppressWarnings("deprecation")
    private String wifiCurrent() {
        if (!wifiConnected()) return "";
        try {
            WifiManager wm = wifi();
            String ssid = wm == null || wm.getConnectionInfo() == null ? "" : wm.getConnectionInfo().getSSID();
            if (ssid == null || ssid.equals("<unknown ssid>")) return "";
            if (ssid.length() >= 2 && ssid.startsWith("\"") && ssid.endsWith("\"")) ssid = ssid.substring(1, ssid.length() - 1);
            return ssid;
        } catch (Exception e) {
            return "";
        }
    }

    @SuppressWarnings("deprecation")
    private android.net.wifi.WifiConfiguration configured(WifiManager wm, String name) {
        try {
            java.util.List<android.net.wifi.WifiConfiguration> list = wm.getConfiguredNetworks();
            if (list != null) for (android.net.wifi.WifiConfiguration conf : list) if (("\"" + name + "\"").equals(conf.SSID)) return conf;
        } catch (SecurityException ignored) { }
        return null;
    }

    /* Android 9 and older: joins the network with the password typed in the Gingerbread dialog. Android 10+ keeps
       joining networks for its own Wi-Fi panel, which opens instead. */
    @SuppressWarnings("deprecation")
    private String wifiConnect(String name, String password) {
        WifiManager wm = wifi();
        if (wm == null || name == null || name.isEmpty()) return "no";
        if (Build.VERSION.SDK_INT >= 29) return openSettings(Settings.Panel.ACTION_WIFI);
        try {
            if (!wm.isWifiEnabled()) wm.setWifiEnabled(true);
            String type = "Open";
            for (android.net.wifi.ScanResult result : wm.getScanResults()) if (name.equals(result.SSID)) { type = security(result.capabilities); break; }
            android.net.wifi.WifiConfiguration conf = new android.net.wifi.WifiConfiguration();
            conf.SSID = "\"" + name + "\"";
            if ("Open".equals(type)) {
                conf.allowedKeyManagement.set(android.net.wifi.WifiConfiguration.KeyMgmt.NONE);
            } else if ("WEP".equals(type)) {
                conf.allowedKeyManagement.set(android.net.wifi.WifiConfiguration.KeyMgmt.NONE);
                conf.allowedAuthAlgorithms.set(android.net.wifi.WifiConfiguration.AuthAlgorithm.OPEN);
                conf.allowedAuthAlgorithms.set(android.net.wifi.WifiConfiguration.AuthAlgorithm.SHARED);
                conf.wepKeys[0] = password.matches("[0-9A-Fa-f]{10}|[0-9A-Fa-f]{26}") ? password : "\"" + password + "\"";
                conf.wepTxKeyIndex = 0;
            } else {
                conf.preSharedKey = "\"" + password + "\"";
            }
            int id = wm.addNetwork(conf);
            if (id == -1) {
                // Saved earlier by the phone itself: rejoin it as it is.
                android.net.wifi.WifiConfiguration saved = configured(wm, name);
                if (saved == null) return openSettings(Settings.ACTION_WIFI_SETTINGS);
                id = saved.networkId;
            }
            wm.disconnect();
            boolean ok = wm.enableNetwork(id, true);
            wm.reconnect();
            return ok ? "ok" : "no";
        } catch (Exception e) {
            return openSettings(Settings.ACTION_WIFI_SETTINGS);
        }
    }

    // Forgets a network this launcher added; one the phone saved itself can only be forgotten in its own Wi-Fi page.
    @SuppressWarnings("deprecation")
    private String wifiForget(String name) {
        WifiManager wm = wifi();
        if (wm == null || name == null) return "no";
        if (Build.VERSION.SDK_INT < 29) {
            android.net.wifi.WifiConfiguration saved = configured(wm, name);
            try {
                if (saved != null && wm.removeNetwork(saved.networkId)) { wm.saveConfiguration(); return "ok"; }
            } catch (Exception ignored) { }
        }
        return openSettings(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS);
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

    // ---- Gingerbread Launcher as the phone app -------------------------------------------------------------------

    boolean isDefaultDialer() {
        TelecomManager telecom = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
        return telecom != null && getPackageName().equals(telecom.getDefaultDialerPackage());
    }

    // Asks once (per run of the launcher) to become the default phone app, so calls use the Gingerbread call screen.
    private void offerDefaultDialer() {
        if (askedDialer || isDefaultDialer()) return;
        askedDialer = true;
        try {
            Intent ask;
            if (Build.VERSION.SDK_INT >= 29) {
                android.app.role.RoleManager roles = getSystemService(android.app.role.RoleManager.class);
                if (roles == null || !roles.isRoleAvailable(android.app.role.RoleManager.ROLE_DIALER)) return;
                ask = roles.createRequestRoleIntent(android.app.role.RoleManager.ROLE_DIALER);
            } else {
                ask = new Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER).putExtra(TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME, getPackageName());
            }
            startActivityForResult(ask, DIALER_REQUEST);
        } catch (Exception ignored) { }
    }

    // A call's state from CallService: to the page, plus the lock-screen and proximity handling around calls.
    private void onCallReport(String json, boolean anyLive) {
        if (web != null) web.evaluateJavascript("window.gbRealCall && window.gbRealCall(" + json + ")", null);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(anyLive); setTurnScreenOn(anyLive); }
        else if (anyLive) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        updateProximity();
    }

    @SuppressWarnings("WakelockTimeout")
    private void updateProximity() {
        boolean wanted = CallService.onEarpiece();
        try {
            if (proximityLock == null) {
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm == null || !pm.isWakeLockLevelSupported(android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return;
                proximityLock = pm.newWakeLock(android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "gingerbread:incall");
            }
            if (wanted && !proximityLock.isHeld()) proximityLock.acquire();
            else if (!wanted && proximityLock.isHeld()) proximityLock.release();
        } catch (Exception ignored) { }
    }

    // A "tel:" link or the dial pad opened by another app: the Gingerbread dial pad with the number filled in.
    private boolean handleDialIntent(Intent intent) {
        if (intent == null || web == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_DIAL.equals(action) && !Intent.ACTION_VIEW.equals(action)) return false;
        Uri data = intent.getData();
        String number = data != null && "tel".equals(data.getScheme()) ? data.getSchemeSpecificPart() : "";
        org.json.JSONObject arg = new org.json.JSONObject();
        try { arg.put("number", number == null ? "" : number); } catch (Exception ignored) { }
        web.evaluateJavascript("window.gbOpenDialer && window.gbOpenDialer(" + arg + ".number)", null);
        intent.setAction(Intent.ACTION_MAIN);
        return true;
    }

    // Calls the number straight away once the call permission is allowed; otherwise opens the phone's dialer with it.
    // As the default phone app the call goes through Android's Telecom and comes back on the Gingerbread call screen.
    private void placeCall(String number) {
        String digits = number == null ? "" : number.replaceAll("[^0-9+*#,;]", "");
        if (digits.isEmpty()) return;
        Uri tel = Uri.fromParts("tel", digits, null);
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) {
            if (isDefaultDialer()) {
                try {
                    ((TelecomManager) getSystemService(Context.TELECOM_SERVICE)).placeCall(tel, new Bundle());
                    return;
                } catch (Exception ignored) { }
            }
            startSafely(new Intent(Intent.ACTION_CALL, tel));
            return;
        }
        pendingCall = digits;
        requestPermissions(new String[]{Manifest.permission.CALL_PHONE}, CALL_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == WIFI_SCAN_REQUEST) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) wifiScan();
            tellPageWifiList();
            return;
        }
        if (requestCode == CALL_REQUEST) {
            String number = pendingCall;
            pendingCall = null;
            if (number == null) return;
            Uri tel = Uri.fromParts("tel", number, null);
            boolean allowed = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (allowed) { placeCall(number); return; }
            if (!isDefaultDialer()) startSafely(new Intent(Intent.ACTION_DIAL, tel));
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
        setIntent(intent);
        if (intent.getBooleanExtra(EXTRA_CALL, false)) { CallService.reportAll(); return; }
        if (handleDialIntent(intent)) return;
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
        if (CallService.sink != null) CallService.sink = null;
        if (proximityLock != null && proximityLock.isHeld()) proximityLock.release();
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
        public String wifiScan() {
            final String[] result = {"no"};
            final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
            runOnUiThread(() -> { try { result[0] = MainActivity.this.wifiScan(); } catch (Exception e) { result[0] = "no"; } done.countDown(); });
            try { done.await(3, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            return result[0];
        }

        @JavascriptInterface
        public String wifiNetworks() {
            return wifiNetworksJson();
        }

        @JavascriptInterface
        public String wifiCurrent() {
            return MainActivity.this.wifiCurrent();
        }

        @JavascriptInterface
        public String wifiConnect(String name, String password) {
            return onUi(() -> MainActivity.this.wifiConnect(name, password));
        }

        @JavascriptInterface
        public String wifiForget(String name) {
            return onUi(() -> MainActivity.this.wifiForget(name));
        }

        private String onUi(java.util.concurrent.Callable<String> work) {
            final String[] result = {"no"};
            final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
            runOnUiThread(() -> { try { result[0] = work.call(); } catch (Exception e) { result[0] = "no"; } done.countDown(); });
            try { done.await(5, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            return result[0];
        }

        @JavascriptInterface
        public String settings() {
            return settingsJson();
        }

        // Runs on the UI thread and waits for the answer, since some settings open Android's own pages.
        @JavascriptInterface
        public String setSetting(String key, String value) {
            final String[] result = {"no"};
            final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
            runOnUiThread(() -> { try { result[0] = MainActivity.this.setSetting(key, value); } catch (Exception e) { result[0] = "no"; } done.countDown(); });
            try { done.await(3, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            return result[0];
        }

        // 'incall' when the call will show on the Gingerbread call screen (the launcher is the default phone app).
        @JavascriptInterface
        public String call(String number) {
            boolean ours = isDefaultDialer();
            runOnUiThread(() -> placeCall(number));
            return ours ? "incall" : "system";
        }

        @JavascriptInterface
        public String callAction(String id, String action, String value) {
            return onUi(() -> CallService.act(id, action, value));
        }

        @JavascriptInterface
        public String callNow() {
            runOnUiThread(CallService::reportAll);
            return "";
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
