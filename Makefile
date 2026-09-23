# Development shortcuts for Awalé.
#
# Everything here wraps the npm scripts in package.json and server/package.json;
# nothing is defined only in this file, so the CI workflows and the Makefile
# cannot drift apart. Run `make` on its own for the list.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Where the match server lives. It has its own package.json and lockfile because
# it is deployed as a Cloudflare Worker, not bundled with the web app.
SERVER_DIR := server

# Markers let `make` skip `npm ci` when node_modules is already newer than the
# lockfile, so `make dev` on a warm checkout starts straight away.
NODE_MODULES := node_modules/.package-lock.json
SERVER_MODULES := $(SERVER_DIR)/node_modules/.package-lock.json

# The address the game uses to reach the match server. `same-origin` is what
# production ships; point it at a local Worker to develop online play.
VITE_ONLINE_URL ?=

.PHONY: help install install-web install-server dev dev-server dev-online \
        build build-prod preview lint typecheck test test-e2e test-challenges \
        test-server check verify sound deploy preview-worker preview-worker-delete \
        tail sync open-android open-ios run-android run-ios clean distclean

## help: list the targets
help:
	@echo 'Awalé — make targets'
	@echo
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /' | awk -F': ' '{printf "  %-18s %s\n", $$1, $$2}' | sed 's/^  //'

# --- setup -----------------------------------------------------------------

## install: install web and server dependencies
install: install-web install-server

## install-web: npm ci for the web app
install-web: $(NODE_MODULES)

$(NODE_MODULES): package-lock.json package.json
	npm ci
	@touch $@

## install-server: npm ci for the match server
install-server: $(SERVER_MODULES)

$(SERVER_MODULES): $(SERVER_DIR)/package-lock.json $(SERVER_DIR)/package.json
	cd $(SERVER_DIR) && npm ci
	@touch $@

# --- running ---------------------------------------------------------------

## dev: Vite dev server, reachable from a phone on the LAN
dev: install-web
	npm run dev

## dev-server: the match server on :8787
dev-server: install-web
	npm run dev:server

## dev-online: the game pointed at a local match server (run dev-server too)
dev-online: install-web
	VITE_ONLINE_URL=$${VITE_ONLINE_URL:-ws://127.0.0.1:8787} npm run dev

## preview: serve the production build locally
preview: build
	npm run preview

# --- building --------------------------------------------------------------

## build: typecheck and build the web app into dist/
build: install-web
	VITE_ONLINE_URL=$(VITE_ONLINE_URL) npm run build

## build-prod: build the way the deploy workflow does (same-origin server)
build-prod: install-web
	VITE_ONLINE_URL=same-origin npm run build

# --- checks ----------------------------------------------------------------

## lint: ESLint over the repository
lint: install-web
	npm run lint

## typecheck: TypeScript, web app and Worker, no emit
typecheck: install-web install-server
	npx tsc -b --pretty
	cd $(SERVER_DIR) && npm run typecheck

## test: the unit suites
test: install-web
	npm test

## test-e2e: Playwright, desktop and phone viewports
test-e2e: install-web
	npx playwright install --with-deps chromium
	npm run test:e2e

## test-challenges: seed conservation and solvability of the puzzles
test-challenges: install-web
	npm run verify:challenges

## test-server: typecheck the Worker against the Cloudflare types
test-server: install-server
	cd $(SERVER_DIR) && npm run typecheck

## check: what CI runs on every push — lint, build, unit tests
check: lint build test

## verify: everything CI runs, end-to-end suites included
verify: check test-server test-challenges test-e2e

## sound: regenerate one sound clip with ElevenLabs, e.g. `make sound NAME=scoop-2`
sound: install-web
ifndef NAME
	$(error usage: make sound NAME=<clip-name>, e.g. NAME=scoop-2 — see scripts/gen-sounds.ts for the list)
endif
	npm run sounds:generate -- $(NAME)

# --- deploying -------------------------------------------------------------

## deploy: build and push the Worker (site and rooms) to Cloudflare
deploy: build-prod install-server
	cd $(SERVER_DIR) && npm run deploy

## preview-worker: deploy this branch to its own Worker Preview URL (real Durable Objects, isolated from prod)
preview-worker: install-server
	cd $(SERVER_DIR) && npm run preview

## preview-worker-delete: tear down this branch's Worker Preview
preview-worker-delete: install-server
	cd $(SERVER_DIR) && npx wrangler preview delete

## tail: stream live Worker logs
tail: install-server
	cd $(SERVER_DIR) && npm run tail

# --- native shells ---------------------------------------------------------

## sync: rebuild the web app and copy it into the iOS and Android shells
sync: build
	npx cap sync

## open-android: open the Android shell in Android Studio
open-android: sync
	npx cap open android

## open-ios: open the iOS shell in Xcode (macOS only)
open-ios: sync
	npx cap open ios

## run-android: run on a device or emulator with live reload
run-android: install-web
	npx cap run android -l --external

## run-ios: run on a device or simulator with live reload
run-ios: install-web
	npx cap run ios -l --external

# --- housekeeping ----------------------------------------------------------

## clean: remove build output and test reports
clean:
	rm -rf dist playwright-report test-results

## distclean: clean, plus every installed dependency
distclean: clean
	rm -rf node_modules $(SERVER_DIR)/node_modules
