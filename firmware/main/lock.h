// Badge lock: only the phone that holds the owner key can change the badge.
// The key (16 random bytes from the phone) lives in NVS. A phone proves it
// holds the key by answering a fresh challenge with HMAC-SHA-256(key, nonce),
// so the key itself crosses the air only once, when the badge is locked.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#define LOCK_KEY_BYTES 16

esp_err_t lock_init(void);

// An owner key is set.
bool lock_is_locked(void);

// This connection may change the badge: unlocked, or authorized.
bool lock_allowed(void);

// This connection answered a challenge (or set the key).
bool lock_authorized(void);

// Sets (or replaces) the owner key and authorizes this connection.
esp_err_t lock_set_key(const uint8_t key[LOCK_KEY_BYTES]);

// Erases the owner key.
esp_err_t lock_clear(void);

// Makes a fresh nonce for this connection; the previous one is forgotten.
void lock_challenge(uint8_t nonce[LOCK_KEY_BYTES]);

// Checks an answer to the last challenge. One try per challenge.
// ESP_OK authorizes this connection; ESP_ERR_INVALID_STATE: no challenge
// pending; ESP_FAIL: wrong answer.
esp_err_t lock_answer(const uint8_t answer[LOCK_KEY_BYTES]);

// The connection ended: forget the authorization and any pending challenge.
void lock_disconnected(void);
