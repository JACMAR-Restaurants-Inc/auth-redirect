# auth-redirect

A single static page that finishes Google sign-in for Jacmar's internal apps.

## Why this exists

The apps are Google Apps Script web apps. When Google redirects straight back to a
`script.google.com/macros/.../exec` URL after sign-in, Google inserts its own account
router — `script.google.com/accounts?authuser=N&continueUrl=…` — and that router fails
with **"Sorry, unable to open the file at this time"** whenever the browser has more than
one Google account signed in.

Staff use personal phones and laptops, so more than one Google account is the normal case,
not the exception. That made the sign-in unusable for most people.

Loading the same `/exec` URL with the same parameters works perfectly when the navigation
comes from anywhere other than Google. So this page is registered as the OAuth redirect URI
instead: Google redirects here, and this page forwards to the portal. One extra hop, and the
router never engages.

## What it does

Reads `state`, `code` and `error` from the query string and forwards only those to the
portal. Everything else Google appends — `authuser`, `scope`, `iss`, `prompt` — is dropped.

## What it does not do

No sign-in, no tokens, no secrets. It cannot authenticate anybody. The authorization code it
forwards is single-use, expires in about a minute, and is worthless without the OAuth client
secret, which lives only in the Apps Script project and is never present here.

This repository is public because GitHub Pages requires it. There is nothing in it worth
hiding.
