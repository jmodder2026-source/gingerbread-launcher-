package net.gingerbread.launcher;

import android.annotation.SuppressLint;
import android.app.Activity;
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
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
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

    private WebView web;
    private BroadcastReceiver packageReceiver;
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
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_PACKAGE_ADDED);
        filter.addAction(Intent.ACTION_PACKAGE_REMOVED);
        filter.addAction(Intent.ACTION_PACKAGE_CHANGED);
        filter.addDataScheme("package");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(packageReceiver, filter, Context.RECEIVER_EXPORTED);
        else registerReceiver(packageReceiver, filter);
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

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
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
        if (web != null) web.evaluateJavascript("window.gbOnPause && window.gbOnPause()", null);
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.gbOnResume && window.gbOnResume()", null);
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
            if (!backHeld && !event.isCanceled()) pressKey(".touch-back");
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
        pressKey(".touch-back");
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (packageReceiver != null) unregisterReceiver(packageReceiver);
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
        public void openDialer() {
            runOnUiThread(() -> startSafely(new Intent(Intent.ACTION_DIAL)));
        }

        @JavascriptInterface
        public void openBrowser() {
            runOnUiThread(() -> startSafely(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)));
        }
    }
}
