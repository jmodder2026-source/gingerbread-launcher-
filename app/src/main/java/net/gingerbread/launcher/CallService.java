package net.gingerbread.launcher;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.telecom.Call;
import android.telecom.CallAudioState;
import android.telecom.InCallService;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.telecom.VideoProfile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * Android hands every phone call to this service while Gingerbread Launcher is the default phone app. Each change is
 * reported to the launcher page (window.gbRealCall) as JSON, and the page's buttons come back through {@link #act}.
 * Android itself still plays the ringtone and keeps the call log.
 */
public class CallService extends InCallService {
    /** Receives one call's state as JSON; set by MainActivity while it is alive. */
    public interface Sink { void onCall(String json, boolean anyLive); }

    static CallService instance;
    static Sink sink;
    private static final Map<Call, String> ids = new IdentityHashMap<>();
    private static final Map<Call, Boolean> incoming = new IdentityHashMap<>();
    private static int nextId = 1;
    private final Handler main = new Handler(Looper.getMainLooper());

    private final Call.Callback callback = new Call.Callback() {
        @Override
        public void onStateChanged(Call call, int state) { report(call); }

        @Override
        public void onDetailsChanged(Call call, Call.Details details) { report(call); }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public void onCallAdded(Call call) {
        super.onCallAdded(call);
        synchronized (ids) {
            ids.put(call, "c" + (nextId++));
            incoming.put(call, state(call) == Call.STATE_RINGING);
        }
        call.registerCallback(callback);
        report(call);
        // Bring the Gingerbread call screen up (over the lock screen too).
        Intent show = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra(MainActivity.EXTRA_CALL, true);
        try { startActivity(show); } catch (Exception ignored) { }
    }

    @Override
    public void onCallRemoved(Call call) {
        super.onCallRemoved(call);
        call.unregisterCallback(callback);
        String json = json(call, "disconnected");
        synchronized (ids) { ids.remove(call); incoming.remove(call); }
        send(json);
    }

    @Override
    public void onCallAudioStateChanged(CallAudioState audioState) {
        super.onCallAudioStateChanged(audioState);
        for (Call call : calls()) report(call);
    }

    // ---- reporting -----------------------------------------------------------------------------------------------

    @SuppressWarnings("deprecation")
    private static int state(Call call) {
        return Build.VERSION.SDK_INT >= 31 ? call.getDetails().getState() : call.getState();
    }

    static List<Call> calls() {
        synchronized (ids) { return new ArrayList<>(ids.keySet()); }
    }

    static boolean anyLive() {
        for (Call call : calls()) {
            int s = state(call);
            if (s != Call.STATE_DISCONNECTED && s != Call.STATE_DISCONNECTING) return true;
        }
        return false;
    }

    /** True while a call is connecting or talking on the earpiece (the screen may go dark at the ear). */
    static boolean onEarpiece() {
        CallService service = instance;
        CallAudioState audio = service == null ? null : service.getCallAudioState();
        if (audio != null && audio.getRoute() != CallAudioState.ROUTE_EARPIECE && audio.getRoute() != CallAudioState.ROUTE_WIRED_HEADSET) return false;
        for (Call call : calls()) {
            int s = state(call);
            if (s == Call.STATE_ACTIVE || s == Call.STATE_DIALING || s == Call.STATE_CONNECTING) return audio == null || audio.getRoute() == CallAudioState.ROUTE_EARPIECE;
        }
        return false;
    }

    private void report(Call call) { send(json(call, null)); }

    private void send(String json) {
        main.post(() -> { Sink s = sink; if (s != null && json != null) s.onCall(json, anyLive()); });
    }

    /** Every call again, for a page that has just loaded. */
    static void reportAll() {
        CallService service = instance;
        if (service == null) return;
        for (Call call : calls()) service.report(call);
    }

    static String stateName(int s) {
        switch (s) {
            case Call.STATE_RINGING: return "ringing";
            case Call.STATE_NEW: case Call.STATE_CONNECTING: case Call.STATE_DIALING: case Call.STATE_PULLING_CALL: return "dialing";
            case Call.STATE_SELECT_PHONE_ACCOUNT: return "select-account";
            case Call.STATE_HOLDING: return "holding";
            case Call.STATE_DISCONNECTING: return "disconnecting";
            case Call.STATE_DISCONNECTED: return "disconnected";
            default: return "active";
        }
    }

    @SuppressWarnings("deprecation")
    private String json(Call call, String forcedState) {
        try {
            String id;
            boolean in;
            synchronized (ids) { id = ids.get(call); in = Boolean.TRUE.equals(incoming.get(call)); }
            if (id == null) return null;
            Call.Details details = call.getDetails();
            Uri handle = details == null ? null : details.getHandle();
            String number = handle == null ? "" : handle.getSchemeSpecificPart();
            if (number == null || number.isEmpty()) number = "Private number";
            if (Build.VERSION.SDK_INT >= 29 && details != null) in = details.getCallDirection() == Call.Details.DIRECTION_INCOMING;
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("number", number);
            String st = forcedState != null ? forcedState : stateName(state(call));
            o.put("state", st);
            o.put("incoming", in);
            if (details != null && details.getConnectTimeMillis() > 0) o.put("connectTime", details.getConnectTimeMillis());
            CallAudioState audio = getCallAudioState();
            if (audio != null) {
                o.put("mute", audio.isMuted());
                o.put("speaker", audio.getRoute() == CallAudioState.ROUTE_SPEAKER);
                o.put("bluetooth", audio.getRoute() == CallAudioState.ROUTE_BLUETOOTH);
                o.put("bluetoothAvailable", (audio.getSupportedRouteMask() & CallAudioState.ROUTE_BLUETOOTH) != 0);
            }
            if ("select-account".equals(st)) {
                JSONArray labels = new JSONArray();
                for (PhoneAccountHandle account : accounts(call)) labels.put(label(account));
                o.put("accounts", labels);
            }
            return o.toString();
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private static List<PhoneAccountHandle> accounts(Call call) {
        List<PhoneAccountHandle> list = null;
        Bundle extras = call.getDetails() == null ? null : call.getDetails().getIntentExtras();
        try { if (call.getDetails() != null && call.getDetails().getExtras() != null) list = call.getDetails().getExtras().getParcelableArrayList(Call.AVAILABLE_PHONE_ACCOUNTS); } catch (Exception ignored) { }
        if (list == null && extras != null) try { list = extras.getParcelableArrayList(Call.AVAILABLE_PHONE_ACCOUNTS); } catch (Exception ignored) { }
        return list == null ? new ArrayList<>() : list;
    }

    private String label(PhoneAccountHandle handle) {
        try {
            TelecomManager telecom = (TelecomManager) getSystemService(TELECOM_SERVICE);
            PhoneAccount account = telecom == null ? null : telecom.getPhoneAccount(handle);
            if (account != null && account.getLabel() != null) return account.getLabel().toString();
        } catch (Exception ignored) { }
        return "SIM";
    }

    // ---- the page's buttons --------------------------------------------------------------------------------------

    private static Call find(String id) {
        synchronized (ids) {
            for (Map.Entry<Call, String> entry : ids.entrySet()) if (entry.getValue().equals(id)) return entry.getKey();
        }
        return null;
    }

    /** answer, reject, hangup, hold, unhold, mute, speaker, bluetooth, dtmf or account, for the call with this id. */
    static String act(String id, String action, String value) {
        Call call = find(id);
        CallService service = instance;
        if (call == null || service == null) return "no";
        boolean on = "true".equals(value);
        switch (action) {
            case "answer": call.answer(VideoProfile.STATE_AUDIO_ONLY); return "ok";
            case "reject": call.reject(false, null); return "ok";
            case "hangup": call.disconnect(); return "ok";
            case "hold": call.hold(); return "ok";
            case "unhold": call.unhold(); return "ok";
            case "mute": service.setMuted(on); return "ok";
            case "speaker": service.setAudioRoute(on ? CallAudioState.ROUTE_SPEAKER : CallAudioState.ROUTE_WIRED_OR_EARPIECE); return "ok";
            case "bluetooth": service.setAudioRoute(on ? CallAudioState.ROUTE_BLUETOOTH : CallAudioState.ROUTE_WIRED_OR_EARPIECE); return "ok";
            case "dtmf":
                if (value == null || value.isEmpty()) return "no";
                call.playDtmfTone(value.charAt(0));
                service.main.postDelayed(call::stopDtmfTone, 150);
                return "ok";
            case "account": {
                List<PhoneAccountHandle> list = accounts(call);
                int index;
                try { index = Integer.parseInt(value); } catch (NumberFormatException e) { return "no"; }
                if (index < 0 || index >= list.size()) return "no";
                call.phoneAccountSelected(list.get(index), false);
                return "ok";
            }
            default: return "no";
        }
    }
}
