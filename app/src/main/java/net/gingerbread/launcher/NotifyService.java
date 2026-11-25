package net.gingerbread.launcher;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Hands the phone's SMS and email notifications to the launcher, which shows them in the 2.3.6 / 2.1 status bar and
 * notification shade. Android starts this service once the user allows "Notification access" for the launcher.
 */
public class NotifyService extends NotificationListenerService {
    /** The running listener (null while Android has it unbound). */
    static volatile NotifyService current;
    /** Called with the full list (a JSON array) whenever it changes. */
    static volatile Sink sink;

    interface Sink { void notes(String json); }
    /** Called when a new text or email arrives (the Messaging / Email / Gmail apps refresh their lists). */
    static volatile Runnable inboxChanged;
    private static final String HISTORY = "emailHistory";

    /** The emails the phone has notified about, newest first (kept after the notification is gone, at most 60). */
    static String emailHistory(Context context) {
        return context.getSharedPreferences("launcher", MODE_PRIVATE).getString(HISTORY, "[]");
    }

    private void remember(StatusBarNotification sbn) {
        try {
            Bundle extras = sbn.getNotification().extras;
            CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = extras.getCharSequence(Notification.EXTRA_TEXT);
            CharSequence big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (title == null && text == null) return;
            String subject = text == null ? "" : text.toString();
            String body = big == null ? subject : big.toString();
            JSONObject mail = new JSONObject().put("key", sbn.getKey()).put("app", sbn.getPackageName())
                    .put("from", title == null ? "" : title.toString()).put("subject", subject).put("body", body).put("when", sbn.getPostTime());
            JSONArray old = new JSONArray(emailHistory(this)), next = new JSONArray().put(mail);
            for (int i = 0; i < old.length() && next.length() < 60; i++) {
                JSONObject o = old.getJSONObject(i);
                if (!o.optString("key").equals(sbn.getKey())) next.put(o);
            }
            getSharedPreferences("launcher", MODE_PRIVATE).edit().putString(HISTORY, next.toString()).apply();
        } catch (Exception ignored) { }
    }

    // Email apps of common phones (anything posting with CATEGORY_EMAIL counts too).
    private static final Set<String> EMAIL = new HashSet<>(Arrays.asList(
            "com.google.android.gm", "com.google.android.gm.lite", "com.samsung.android.email.provider", "com.android.email",
            "com.microsoft.office.outlook", "com.yahoo.mobile.client.android.mail", "ch.protonmail.android", "com.yandex.mail",
            "me.bluemail.mail", "com.easilydo.mail", "com.fsck.k9", "com.huawei.email", "com.mi.android.globalmail"));
    // Messaging apps besides the default SMS app.
    private static final Set<String> SMS = new HashSet<>(Arrays.asList(
            "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging",
            "com.sonyericsson.conversations", "com.motorola.messaging", "com.oneplus.mms"));

    static boolean allowed(Context context) {
        String enabled = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(new ComponentName(context, NotifyService.class).flattenToString());
    }

    @Override
    public void onListenerConnected() {
        current = this;
        report();
    }

    @Override
    public void onListenerDisconnected() {
        if (current == this) current = null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String kind = kind(sbn);
        if (kind == null) return;
        if (kind.equals("email")) remember(sbn);
        report();
        Runnable changed = inboxChanged;
        if (changed != null) changed.run();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) { if (kind(sbn) != null) report(); }

    /** "sms", "email" or null for a notification the launcher does not show. */
    private String kind(StatusBarNotification sbn) {
        if (sbn == null || sbn.isOngoing()) return null;
        Notification n = sbn.getNotification();
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return null;
        String pkg = sbn.getPackageName();
        String sms = null;
        try { sms = Telephony.Sms.getDefaultSmsPackage(this); } catch (Exception ignored) { }
        if (pkg.equals(sms) || SMS.contains(pkg)) return "sms";
        if (EMAIL.contains(pkg) || Notification.CATEGORY_EMAIL.equals(n.category)) return "email";
        if (Notification.CATEGORY_MESSAGE.equals(n.category) && pkg.equals(sms)) return "sms";
        return null;
    }

    String json() {
        JSONArray list = new JSONArray();
        StatusBarNotification[] all;
        try { all = getActiveNotifications(); } catch (Exception e) { all = null; }
        if (all == null) return "[]";
        Arrays.sort(all, (a, b) -> Long.compare(b.getPostTime(), a.getPostTime()));
        for (StatusBarNotification sbn : all) {
            String kind = kind(sbn);
            if (kind == null) continue;
            Bundle extras = sbn.getNotification().extras;
            CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = extras.getCharSequence(Notification.EXTRA_TEXT);
            if (text == null) text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (title == null && text == null) continue;
            try {
                list.put(new JSONObject().put("key", sbn.getKey()).put("kind", kind).put("app", sbn.getPackageName())
                        .put("title", title == null ? "" : title.toString()).put("text", text == null ? "" : text.toString())
                        .put("when", sbn.getPostTime()));
            } catch (Exception ignored) { }
        }
        return list.toString();
    }

    private void report() {
        Sink s = sink;
        if (s != null) s.notes(json());
    }

    /** Runs the notification's own action (opens the conversation or the email) and clears it if it auto-cancels. */
    boolean open(String key) {
        try {
            for (StatusBarNotification sbn : getActiveNotifications()) {
                if (!sbn.getKey().equals(key)) continue;
                PendingIntent action = sbn.getNotification().contentIntent;
                if (action != null) {
                    if (Build.VERSION.SDK_INT >= 34) {
                        android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic()
                                .setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                        action.send(this, 0, null, null, null, null, options.toBundle());
                    } else {
                        action.send();
                    }
                }
                if ((sbn.getNotification().flags & Notification.FLAG_AUTO_CANCEL) != 0) cancelNotification(key);
                return action != null;
            }
        } catch (Exception ignored) { }
        return false;
    }

    void clearShown() {
        try {
            for (StatusBarNotification sbn : getActiveNotifications()) if (kind(sbn) != null && sbn.isClearable()) cancelNotification(sbn.getKey());
        } catch (Exception ignored) { }
    }
}
