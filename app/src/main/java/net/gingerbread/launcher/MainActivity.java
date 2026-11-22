package net.gingerbread.launcher;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
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
import java.util.List;

/**
 * A home screen app that runs the Android 2.3.6 Gingerbread simulator (bundled in assets/site) full screen.
 * The page reads the phone's real apps through window.AndroidLauncher and opens them with it.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/site/versions/2.3.6/index.html";
    private static final int ICON_PX = 96;

    private WebView web;
    private BroadcastReceiver packageReceiver;

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

    // The phone's Back button presses the simulator's Back key; a launcher never closes itself.
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web != null) web.evaluateJavascript("(function(){var k=document.querySelector('.touch-back');if(k)k.click();})()", null);
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
        public void openDialer() {
            runOnUiThread(() -> startSafely(new Intent(Intent.ACTION_DIAL)));
        }

        @JavascriptInterface
        public void openBrowser() {
            runOnUiThread(() -> startSafely(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)));
        }
    }
}
