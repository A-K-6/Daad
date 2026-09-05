/* Standalone acceptance driver using the SAME adapter as the application.
 * Credentials come from environment, never argv or printed diagnostics.
 * Null device provides a real media clock; a generated tone crosses SRTP
 * through Asterisk Echo and is recorded locally for signal verification. */
#include "pjsua_adapter.h"
#include <pjsua-lib/pjsua.h>
#include <pjmedia/tonegen.h>
#include <pjmedia/transport_srtp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static int registered, confirmed, failed, incoming, ended, media_updated;
static long long monotonic_ms(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}
static void event(void *ctx, const daad_event *ev) {
    (void)ctx;
    printf("event kind=%d code=%d state=%d incoming=%d\n", ev->kind, ev->code, ev->state, ev->incoming);
    fflush(stdout);
    if (ev->kind == 1 && ev->state) registered = 1;
    if (ev->kind == 1 && ev->code >= 400) failed = 1;
    if (ev->kind == 2 && ev->incoming && ev->state == PJSIP_INV_STATE_INCOMING) incoming = 1;
    if (ev->kind == 2 && ev->state == PJSIP_INV_STATE_CONFIRMED) confirmed = 1;
    if (ev->kind == 2 && ev->state == PJSIP_INV_STATE_DISCONNECTED) ended = 1;
    if (ev->kind == 5) media_updated = 1;
}
static int check(int code, const char *operation) {
    if (!code) return 0;
    char error[256];
    daad_error(code, error, sizeof(error));
    fprintf(stderr, "%s failed: %s (%d)\n", operation, error, code);
    daad_destroy();
    return 1;
}
int main(int argc, char **argv) {
    if (argc != 3) { fprintf(stderr, "usage: smoke CA_FILE OUTPUT_WAV\n"); return 2; }
    const char *password = getenv("DAAD_TEST_PASSWORD");
    const char *user = getenv("DAAD_TEST_USER");
    if (!password || !user) return 2;
    FILE *file = fopen(argv[1], "rb");
    if (!file) return 2;
    char ca[16384] = {0};
    fread(ca, 1, sizeof(ca) - 1, file);
    fclose(file);
    char identity[256];
    snprintf(identity, sizeof(identity), "sip:%s@127.0.0.1", user);
    if (check(daad_init(event, NULL, 1), "init")) return 1;
    if (check(daad_account("127.0.0.1", 15061, "tls", identity,
        "sip:127.0.0.1:15061;transport=tls", user, password, ca, 120), "account")) return 1;
    if (check(daad_register(1), "register")) return 1;
    for (int i = 0; i < 1500 && !registered && !failed; ++i) daad_poll(20);
    if (!registered) { fprintf(stderr, "registration did not succeed\n"); daad_destroy(); return 1; }
    if (getenv("DAAD_TEST_RECEIVE")) {
        for (int i = 0; i < 1500 && !incoming; ++i) daad_poll(20);
        if (!incoming || check(daad_answer(), "answer")) { daad_destroy(); return 1; }
    } else {
        const char *target = getenv("DAAD_TEST_TARGET");
        if (check(daad_dial(target ? target : "sip:600@127.0.0.1:15061;transport=tls"), "dial")) return 1;
    }
    for (int i = 0; i < 1000 && !confirmed && !ended; ++i) daad_poll(20);
    if (!confirmed) { fprintf(stderr, "call did not answer\n"); daad_destroy(); return 1; }
    pjsua_call_id calls[2]; unsigned count = 2;
    pjsua_enum_calls(calls, &count);
    if (!count) { daad_destroy(); return 1; }
    pjsua_call_info ci; pjsua_call_get_info(calls[0], &ci);
    pjmedia_transport_info transport_info;
    pjmedia_transport_info_init(&transport_info);
    if (check(pjsua_call_get_med_transport_info(calls[0], 0, &transport_info), "media transport")) return 1;
    pjmedia_srtp_info *srtp = pjmedia_transport_info_get_spc_info(&transport_info, PJMEDIA_TRANSPORT_TYPE_SRTP);
    if (!srtp || !srtp->active) { fprintf(stderr, "SRTP was not active\n"); daad_destroy(); return 1; }
    puts("media srtp_active=1");
    pjsua_recorder_id recorder;
    pj_str_t output = pj_str(argv[2]);
    if (check(pjsua_recorder_create(&output, 0, NULL, 0, 0, &recorder), "recorder")) return 1;
    pjsua_conf_connect(ci.conf_slot, pjsua_recorder_get_conf_port(recorder));
    pj_pool_t *pool = pjsua_pool_create("smoke", 2048, 2048);
    pjmedia_port *tone; pjsua_conf_port_id slot;
    pjmedia_tonegen_create(pool, 8000, 1, 160, 16, 0, &tone);
    pjsua_conf_add_port(pool, tone, &slot);
    pjmedia_tone_desc desc = {0};
    desc.freq1 = 997; desc.on_msec = 500; desc.off_msec = 500; desc.volume = 12000;
    pjmedia_tonegen_play(tone, 1, &desc, PJMEDIA_TONEGEN_LOOP);
    pjsua_conf_connect(slot, ci.conf_slot);
    media_updated = 0;
    const long long audio_deadline = monotonic_ms() + 8000;
    while (monotonic_ms() < audio_deadline && !ended) {
        daad_poll(20);
        if (media_updated) {
            media_updated = 0;
            pjsua_call_get_info(calls[0], &ci);
            pjsua_conf_connect(ci.conf_slot, pjsua_recorder_get_conf_port(recorder));
            pjsua_conf_connect(slot, ci.conf_slot);
        }
    }
    pjsua_stream_stat stats;
    if (!pjsua_call_get_stream_stat(calls[0], 0, &stats))
        printf("media tx_packets=%u rx_packets=%u\n", stats.rtcp.tx.pkt, stats.rtcp.rx.pkt);
    pjsua_conf_disconnect(slot, ci.conf_slot);
    pjsua_conf_remove_port(slot);
    pjmedia_port_destroy(tone);
    pj_pool_release(pool);
    pjsua_recorder_destroy(recorder);
    if (getenv("DAAD_TEST_DTMF")) {
        /* Asterisk Echo exits on #. No in-band # tone is generated here. */
        if (ended || check(daad_dtmf("#"), "RFC4733 digit")) { daad_destroy(); return 1; }
        const long long dtmf_deadline = monotonic_ms() + 5000;
        while (!ended && monotonic_ms() < dtmf_deadline) daad_poll(20);
        if (!ended) { fprintf(stderr, "Asterisk did not exit Echo on RFC4733 #\n"); daad_destroy(); return 1; }
        puts("dtmf rfc4733_hash_received=1");
    }
    if (check(daad_hangup(0), "hangup")) return 1;
    for (int i = 0; i < 200 && !ended; ++i) daad_poll(20);
    daad_register(0);
    for (int i = 0; i < 100; ++i) daad_poll(20);
    daad_destroy();
    return ended ? 0 : 1;
}
