# Shortcuts for the app. Run from this folder: `make help`.
# The app is static (no build step): publishing is checking it and pushing `main` to GitHub.

.PHONY: help test test-ui version check publish-check publish

help:           ## list the targets
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | sed -E 's/:[^#]*## /\t/'

test:           ## tests that need no packages (engine vs R, parsing, phases, live, cleaning, comparable quantities)
	@for t in engine parse phases live clean comparable; do \
		out=$$(node tests/test_$$t.js 2>&1) || { echo "$$out" | tail -25; echo "test_$$t FAILED"; exit 1; }; \
		echo "test_$$t: $$(echo "$$out" | tail -1)"; \
	done

test-ui:        ## the page in jsdom (needs: cd tests && npm i jsdom@24 chart.js@4.4.1 @napi-rs/canvas)
	cd tests && node test_ui.js

version:        ## app.js `version` equals every ?v= stamp in index.html
	@v=$$(sed -n "s/^ *version: '\([^']*\)'.*/\1/p" app.js | head -1); \
	[ -n "$$v" ] || { echo "No version found in app.js"; exit 1; }; \
	bad=$$(grep -o '?v=[0-9][0-9.]*' index.html | sort -u | grep -v "?v=$$v$$" || true); \
	[ -z "$$bad" ] || { echo "app.js says $$v but index.html has: $$bad"; exit 1; }; \
	echo "version $$v: app.js and index.html agree"

check: test version  ## tests + version stamps

publish-check:  ## what would be published: branch, uncommitted changes, commits not yet on origin (nothing is pushed)
	@git fetch -q origin
	@echo "branch: $$(git branch --show-current)   version: $$(sed -n "s/^ *version: '\([^']*\)'.*/\1/p" app.js | head -1)"
	@git status --short
	@echo "--- commits to push:"; git log --oneline origin/main..HEAD
	@echo "--- commits only on origin:"; git log --oneline HEAD..origin/main

publish: check  ## check, then push `main` to origin (refuses with uncommitted changes, on another branch, or behind origin)
	@[ "$$(git branch --show-current)" = main ] || { echo "Not on main."; exit 1; }; \
	[ -z "$$(git status --porcelain)" ] || { echo "Uncommitted changes: commit them first (make publish-check)."; exit 1; }; \
	git fetch -q origin; \
	[ -z "$$(git log --oneline HEAD..origin/main)" ] || { echo "origin/main has commits you do not have: pull first."; exit 1; }; \
	[ -n "$$(git log --oneline origin/main..HEAD)" ] || { echo "Nothing to push: origin/main is already up to date."; exit 0; }; \
	git push origin main && echo "Pushed. If scripts changed, bump the version (app.js and the ?v= stamps) so browsers do not serve stale files."
