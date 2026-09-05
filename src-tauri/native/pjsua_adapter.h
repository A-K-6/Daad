#ifndef DAAD_PJSUA_ADAPTER_H
#define DAAD_PJSUA_ADAPTER_H

/* All commands run on one registered native thread. PJSIP owns SIP
 * transactions, audio devices, codecs, SRTP, jitter and echo cancellation. */
typedef struct {
    int kind; /* 1 registration, 2 call, 3 transport, 4 media error, 5 media state, 6 certificate failure */
    int code;
    int state;
    int incoming;
    int connected_seconds;
    char remote[512];
} daad_event;
typedef void (*daad_callback)(void *, const daad_event *);

int daad_init(daad_callback callback, void *context, int null_audio);
void daad_poll(int milliseconds);
void daad_destroy(void);
int daad_account(const char *host, int port, const char *transport,
                 const char *identity, const char *registrar,
                 const char *username, const char *password, const char *ca,
                 int expires);
int daad_register(int enabled);
int daad_dial(const char *uri);
int daad_answer(void);
int daad_hangup(int reject);
int daad_mute(int muted);
int daad_hold(int held);
int daad_dtmf(const char *digits);
void daad_error(int code, char *buffer, int length);

#endif
