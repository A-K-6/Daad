#include "pjsua_adapter.h"
#include <pjsua-lib/pjsua.h>
#include <pjmedia/tonegen.h>
#include <string.h>

#if !PJSIP_HAS_TLS_TRANSPORT
#error "Daad requires PJSIP built with TLS support"
#endif
#if !PJMEDIA_HAS_SRTP
#error "Daad requires SRTP support"
#endif

static daad_callback notify;
static void *notify_context;
static pjsua_acc_id account = PJSUA_INVALID_ID;
static pjsua_call_id active_call = PJSUA_INVALID_ID;
static pjsua_transport_id transport_id = PJSUA_INVALID_ID;
static pj_pool_t *tone_pool;
static pjmedia_port *tone_port;
static pjsua_conf_port_id tone_slot = PJSUA_INVALID_ID;
static int created, silent_audio, capture_muted;

static void emit(int kind, int code, int state, const pjsua_call_info *ci) {
    daad_event event;
    pj_bzero(&event, sizeof(event));
    event.kind = kind;
    event.code = code;
    event.state = state;
    if (ci) {
        event.incoming = ci->role == PJSIP_ROLE_UAS;
        event.connected_seconds = (int)ci->connect_duration.sec;
        pj_ansi_snprintf(event.remote, sizeof(event.remote), "%.*s",
                         (int)ci->remote_info.slen, ci->remote_info.ptr);
    }
    if (notify) notify(notify_context, &event);
}

static void stop_ring(void) {
    if (tone_slot != PJSUA_INVALID_ID) pjsua_conf_disconnect(tone_slot, 0);
    if (tone_port) pjmedia_tonegen_stop(tone_port);
}

static void ring(int incoming) {
    if (silent_audio || !tone_port) return;
    stop_ring();
    pjmedia_tone_desc tone;
    pj_bzero(&tone, sizeof(tone));
    tone.freq1 = 440;
    tone.freq2 = 480;
    tone.on_msec = incoming ? 1000 : 2000;
    tone.off_msec = incoming ? 3000 : 4000;
    tone.volume = 6000;
    pjmedia_tonegen_play(tone_port, 1, &tone, PJMEDIA_TONEGEN_LOOP);
    pjsua_conf_connect(tone_slot, 0);
}

static void registration_changed(pjsua_acc_id id) {
    pjsua_acc_info info;
    if (pjsua_acc_get_info(id, &info) == PJ_SUCCESS)
        emit(1, info.status, info.expires > 0 &&
             info.expires != PJSIP_EXPIRES_NOT_SPECIFIED && info.status / 100 == 2, NULL);
}

static void call_changed(pjsua_call_id id, pjsip_event *event) {
    PJ_UNUSED_ARG(event);
    pjsua_call_info ci;
    if (pjsua_call_get_info(id, &ci) != PJ_SUCCESS) return;
    if (id != active_call && active_call != PJSUA_INVALID_ID) return;
    if (ci.state == PJSIP_INV_STATE_DISCONNECTED) {
        stop_ring();
        emit(2, ci.last_status, ci.state, &ci);
        active_call = PJSUA_INVALID_ID;
        capture_muted = 0;
        return;
    }
    if (ci.state == PJSIP_INV_STATE_CONFIRMED) stop_ring();
    if (ci.state == PJSIP_INV_STATE_EARLY && ci.role == PJSIP_ROLE_UAC &&
        ci.last_status == 180 && ci.media_status != PJSUA_CALL_MEDIA_ACTIVE) ring(0);
    emit(2, ci.last_status, ci.state, &ci);
}

static void incoming_call(pjsua_acc_id acc, pjsua_call_id id, pjsip_rx_data *rdata) {
    PJ_UNUSED_ARG(acc);
    PJ_UNUSED_ARG(rdata);
    if (active_call != PJSUA_INVALID_ID) {
        pjsua_call_answer(id, 486, NULL, NULL);
        return;
    }
    active_call = id;
    pjsua_call_info ci;
    pjsua_call_get_info(id, &ci);
    pjsua_call_answer(id, 180, NULL, NULL);
    ring(1);
    emit(2, 180, PJSIP_INV_STATE_INCOMING, &ci);
}

static void media_changed(pjsua_call_id id) {
    pjsua_call_info ci;
    if (id != active_call || pjsua_call_get_info(id, &ci) != PJ_SUCCESS) return;
    if (ci.media_status == PJSUA_CALL_MEDIA_ACTIVE) {
        stop_ring();
        pj_status_t status = pjsua_conf_connect(ci.conf_slot, 0);
        if (status == PJ_SUCCESS && !capture_muted)
            status = pjsua_conf_connect(0, ci.conf_slot);
        if (status != PJ_SUCCESS) {
            emit(4, status, 0, NULL);
            pjsua_call_hangup(id, 500, NULL, NULL);
            return;
        }
    } else if (ci.media_status == PJSUA_CALL_MEDIA_ERROR) {
        emit(4, PJ_EUNKNOWN, 0, NULL);
        pjsua_call_hangup(id, 488, NULL, NULL);
        return;
    }
    /* Media state 2 means local hold; Rust maps this independently of SIP state. */
    emit(5, 0, ci.media_status, &ci);
}

static void transport_changed(pjsip_transport *tp, pjsip_transport_state state,
                              const pjsip_transport_state_info *info) {
    emit(3, info ? info->status : 0, state, NULL);
    if (tp->key.type == PJSIP_TRANSPORT_TLS && info && info->ext_info) {
        const pjsip_tls_state_info *tls = info->ext_info;
        if (tls->ssl_sock_info && tls->ssl_sock_info->verify_status)
            emit(6, (int)tls->ssl_sock_info->verify_status, 0, NULL);
    }
}

int daad_init(daad_callback callback, void *context, int null_audio) {
    notify = callback;
    notify_context = context;
    silent_audio = null_audio;
    pj_status_t status = pjsua_create();
    if (status != PJ_SUCCESS) return status;
    created = 1;
    pjsua_config cfg;
    pjsua_logging_config logs;
    pjsua_media_config media;
    pjsua_config_default(&cfg);
    pjsua_logging_config_default(&logs);
    pjsua_media_config_default(&media);
    cfg.max_calls = 2; /* spare slot to reject a second incoming call cleanly */
    cfg.thread_cnt = 0;
    cfg.user_agent = pj_str("Daad-native-alpha/PJSIP-2.17");
    cfg.cb.on_incoming_call = incoming_call;
    cfg.cb.on_call_state = call_changed;
    cfg.cb.on_call_media_state = media_changed;
    cfg.cb.on_reg_state = registration_changed;
    cfg.cb.on_transport_state = transport_changed;
    logs.level = 0;
    logs.console_level = 0;
    logs.msg_logging = PJ_FALSE; /* Never dump SIP credentials or SDP keys. */
    media.clock_rate = 16000;
    media.snd_clock_rate = 0;
    media.channel_count = 1;
    media.audio_frame_ptime = 20;
    media.ec_tail_len = 200;
    /* Avoid macOS VoiceProcessingIO blocking SIP callbacks while opening
     * its hardware DSP. Keep echo cancellation in PJSIP's software path. */
    media.ec_options = PJMEDIA_ECHO_USE_SW_ECHO | PJMEDIA_ECHO_SPEEX;
    status = pjsua_init(&cfg, &logs, &media);
    if (status != PJ_SUCCESS) return status;
    pj_str_t all = pj_str("*");
    pjsua_codec_set_priority(&all, 0);
    pj_str_t pcmu = pj_str("PCMU/8000"), pcma = pj_str("PCMA/8000");
    pjsua_codec_set_priority(&pcmu, 255);
    pjsua_codec_set_priority(&pcma, 254);
    status = pjsua_start();
    if (status != PJ_SUCCESS) return status;
    if (silent_audio) return pjsua_set_null_snd_dev();
    tone_pool = pjsua_pool_create("daad-ring", 2048, 2048);
    status = pjmedia_tonegen_create(tone_pool, 16000, 1, 320, 16, 0, &tone_port);
    if (status == PJ_SUCCESS) status = pjsua_conf_add_port(tone_pool, tone_port, &tone_slot);
    return status;
}

int daad_account(const char *host, int port, const char *transport,
                 const char *identity, const char *registrar,
                 const char *username, const char *password, const char *ca,
                 int expires) {
    PJ_UNUSED_ARG(host);
    PJ_UNUSED_ARG(port); /* Remote port is in registrar/proxy, local port is ephemeral. */
    pjsua_transport_config tc;
    pjsua_transport_config_default(&tc);
    tc.port = 0;
    pjsip_transport_type_e type = PJSIP_TRANSPORT_TLS;
    if (strcmp(transport, "tcp") == 0) type = PJSIP_TRANSPORT_TCP;
    if (strcmp(transport, "udp") == 0) type = PJSIP_TRANSPORT_UDP;
    tc.tls_setting.verify_server = PJ_TRUE;
    if (ca && *ca) tc.tls_setting.ca_buf = pj_str((char *)ca);
    pj_status_t status = pjsua_transport_create(type, &tc, &transport_id);
    if (status != PJ_SUCCESS) return status;
    pjsua_acc_config ac;
    pjsua_acc_config_default(&ac);
    ac.id = pj_str((char *)identity);
    ac.reg_uri = pj_str((char *)registrar);
    ac.transport_id = transport_id;
    ac.cred_count = 1;
    ac.cred_info[0].realm = pj_str("*");
    ac.cred_info[0].scheme = pj_str("digest");
    ac.cred_info[0].username = pj_str((char *)username);
    ac.cred_info[0].data_type = PJSIP_CRED_DATA_PLAIN_PASSWD;
    ac.cred_info[0].data = pj_str((char *)password);
    ac.reg_timeout = expires;
    ac.reg_retry_interval = 10;
    ac.reg_first_retry_interval = 2;
    ac.register_on_acc_add = PJ_FALSE;
    ac.use_srtp = PJMEDIA_SRTP_MANDATORY;
    ac.srtp_secure_signaling = type == PJSIP_TRANSPORT_TLS ? 1 : 0;
    ac.allow_contact_rewrite = PJ_TRUE;
    ac.allow_via_rewrite = PJ_TRUE;
    ac.allow_sdp_nat_rewrite = PJ_TRUE;
    ac.ice_cfg_use = PJSUA_ICE_CONFIG_USE_CUSTOM;
    ac.ice_cfg.enable_ice = PJ_FALSE;
    ac.rtp_cfg.port = 0;
    return pjsua_acc_add(&ac, PJ_TRUE, &account);
}

void daad_poll(int milliseconds) { if (created) pjsua_handle_events(milliseconds); }
int daad_register(int enabled) {
    if (account == PJSUA_INVALID_ID) return PJ_EINVALIDOP;
    if (!enabled) pjsua_call_hangup_all();
    return pjsua_acc_set_registration(account, enabled);
}
int daad_dial(const char *uri) {
    if (active_call != PJSUA_INVALID_ID || account == PJSUA_INVALID_ID) return PJ_EINVALIDOP;
    pj_str_t target = pj_str((char *)uri);
    pjsua_call_setting settings;
    pjsua_call_setting_default(&settings);
    settings.aud_cnt = 1;
    settings.vid_cnt = 0;
    return pjsua_call_make_call(account, &target, &settings, NULL, NULL, &active_call);
}
int daad_answer(void) {
    if (active_call == PJSUA_INVALID_ID) return PJ_EINVALIDOP;
    stop_ring();
    return pjsua_call_answer(active_call, 200, NULL, NULL);
}
int daad_hangup(int reject) {
    stop_ring();
    if (active_call == PJSUA_INVALID_ID) return PJ_SUCCESS;
    return pjsua_call_hangup(active_call, reject ? 486 : 0, NULL, NULL);
}
int daad_mute(int muted) {
    pjsua_call_info ci;
    if (active_call == PJSUA_INVALID_ID) return PJ_EINVALIDOP;
    pj_status_t status = pjsua_call_get_info(active_call, &ci);
    if (status != PJ_SUCCESS) return status;
    status = muted ? pjsua_conf_disconnect(0, ci.conf_slot) : pjsua_conf_connect(0, ci.conf_slot);
    if (status == PJ_SUCCESS) capture_muted = muted;
    return status;
}
int daad_hold(int held) {
    if (active_call == PJSUA_INVALID_ID) return PJ_EINVALIDOP;
    return held ? pjsua_call_set_hold(active_call, NULL)
                : pjsua_call_reinvite(active_call, PJSUA_CALL_UNHOLD, NULL);
}
int daad_dtmf(const char *digits) {
    if (active_call == PJSUA_INVALID_ID) return PJ_EINVALIDOP;
    pj_str_t text = pj_str((char *)digits);
    return pjsua_call_dial_dtmf(active_call, &text);
}
void daad_destroy(void) {
    if (!created) return;
    stop_ring();
    if (tone_slot != PJSUA_INVALID_ID) pjsua_conf_remove_port(tone_slot);
    if (tone_port) pjmedia_port_destroy(tone_port);
    if (tone_pool) pj_pool_release(tone_pool);
    tone_slot = PJSUA_INVALID_ID;
    tone_port = NULL;
    tone_pool = NULL;
    pjsua_destroy();
    created = 0;
    account = active_call = transport_id = PJSUA_INVALID_ID;
    capture_muted = 0;
}
void daad_error(int code, char *buffer, int length) {
    pj_strerror(code, buffer, length);
}
