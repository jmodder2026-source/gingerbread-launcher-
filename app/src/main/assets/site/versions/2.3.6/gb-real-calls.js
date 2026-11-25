/* Launcher APK only: real phone calls on Gingerbread's in-call screen. When the launcher is the phone's default
   phone app, Android hands every call to it (an InCallService in the APK), and the APK reports each change with
   window.gbRealCall({id, number, state, incoming, connectTime, mute, speaker, bluetooth, bluetoothAvailable,
   accounts}) where state is 'ringing', 'dialing', 'active', 'holding', 'select-account', 'disconnecting' or
   'disconnected'. The page answers through AndroidLauncher.callAction(id, action, value): answer, reject, hangup,
   hold, unhold, mute, speaker, bluetooth, dtmf, account. AndroidLauncher.callNow() gives the current call (or "")
   for a page that loads while a call is already ringing. */
(() => {
  'use strict';
  const bridge = window.GBRealApps?.active ? window.AndroidLauncher : null;
  const active = !!(bridge?.callAction && bridge?.callNow);

  // IncomingCallWidget and CallCard texts from the Nexus S Phone.apk (packages/apps/Phone res/values*/strings.xml).
  const strings = window.GBStrings?.phone?.strings;
  if (strings) Object.assign(strings, {
    card_title_incoming_call: {en: 'Incoming call', hu: 'Bejövő hívás', de: 'Eingehender Anruf', fr: 'Appel entrant', es: 'Llamada entrante'},
    slide_to_answer_hint: {en: 'Answer', hu: 'Fogadás', de: 'Annehmen', fr: 'Répondre', es: 'Responder'},
    slide_to_decline_hint: {en: 'Decline', hu: 'Elutasítás', de: 'Abweisen', fr: 'Refuser', es: 'Rechazar'}
  });

  let listener = null;
  window.gbRealCall = state => { try { listener?.(typeof state === 'string' ? JSON.parse(state) : state); } catch (error) { /* a malformed report */ } };

  window.GBRealCalls = {
    active,
    onChange: fn => { listener = fn; },
    now: () => { if (!active) return null; try { const s = bridge.callNow(); return s ? JSON.parse(s) : null; } catch (error) { return null; } },
    action: (id, action, value = '') => { if (!active) return 'no'; try { return String(bridge.callAction(String(id), action, String(value))); } catch (error) { return 'no'; } }
  };
})();
