# Trying two-person flows locally

**English** | [繁體中文](two-person-demo.zh-TW.md)

Sharing a document and commenting on it takes two people. Outside a company deployment there is no sign-in, so a local server is always one fixed person. To be two people, run two servers: **the port decides who you are.**

| Address | Who | Started by |
| --- | --- | --- |
| `http://127.0.0.1:3000` | The owner, the `KM_LOCAL_*` identity in `.env` | `make dev` |
| `http://127.0.0.1:3001` | "Local Reviewer", a second fixed identity | `make dev-reviewer` |

Both servers use the same database, so a link made on one opens on the other. The identity is each server's own configuration; nothing in the browser can change it, which is why there is nothing to sign in to and no switcher.

## Before you start

1. In `.env`, set `KM_REVIEW_WRITES_ENABLED=true`. It is `false` by default, and then discussions can be read but not added to. Restart a server that was already running.
2. Start both servers, each in its own terminal:

   ```sh
   make dev
   make dev-reviewer
   ```

3. **Use `127.0.0.1` in the address bar, not `localhost`.** A comment is accepted only when the browser's origin is the address the server is bound to, and the two spellings are different origins. With `localhost` the page loads and reading works, but adding a comment is refused (`REVIEW_ORIGIN_DENIED`).

The first time the reviewer's server answers a request, it creates the reviewer's user and their own My Space in your development database. Nothing deletes a user, so they stay.

## The flow

### 1. The owner writes and shares (port 3000)

1. Open `http://127.0.0.1:3000` and go to My Space. A share link can only be made for a document in a personal workspace.
2. Create a document with two or three paragraphs and save it.
3. Open the document and choose **Share link…** in its header. In the dialog, choose **Create link**, then **Copy link**.

Expect: the new link is listed in the dialog, and the copied address looks like `http://127.0.0.1:3000/s/<token>`.

### 2. The reviewer reads and comments (port 3001)

1. Change `3000` to `3001` in the copied address and open it in another tab.
2. Select some text in a paragraph and choose **Add comment**.
3. Write the comment and submit it.

Expect:

- The document, with **Shared by** naming the owner.
- A **Comments** rail on the right. In a window narrower than 1200px it is an **Open discussions** button that opens a drawer.
- After submitting: the discussion in the rail under the name **Local Reviewer**, and the selected text highlighted in the document. Selecting the highlight focuses its discussion.

### 3. The owner answers (port 3000)

1. Go back to the document on port 3000 and reload it.
2. Scroll to the end of the document and open **Comments**.
3. Reply, then try resolving, reopening and hiding the discussion.

Expect: the reviewer's comment with the passage it quotes; choosing the discussion scrolls to that passage.

### 4. The reviewer sees the outcome (port 3001)

1. On the shared page, refresh the discussions.

Expect:

- The owner's reply.
- No way to reply once the discussion is resolved.
- A hidden discussion is gone from the reviewer's page.

## Worth trying as well

- **The document changes.** The owner edits and saves on 3000. Without reloading, the reviewer tries to comment on 3001: a "Document changed" notice asks for a reload first.
- **The link is revoked.** The owner chooses **Revoke** in the Share link dialog. After a reload the reviewer sees "This link is not available".
- **A narrow window.** Narrow the reviewer's window below 1200px and check that the discussions open in a drawer.

## What this cannot show

- **A reader who is not signed in** ("Sign in to add a comment."). A local identity is always signed in.
- **Signing in, signing out, or a session expiring.** This repository has no implementation of them; a company deployment supplies the session reader.
- **Company SSO groups** and the access they map to.

The first is covered by the E2E suite, which runs a server per fixed persona, one of them with no session (`tests/e2e/fixtures/phase3-server.ts`). The other two can only be checked in a company environment.

## How it works

`make dev-reviewer` is `make dev` with three things changed: the four `KM_LOCAL_*` values, the port, and `KM_NEXT_DIST_DIR=.next-dev-reviewer`, so the two development servers do not write over each other's build output. To be someone else again, start another server the same way with its own values, port and output directory. `KM_LOCAL_ID` must be a UUID, and it and `KM_LOCAL_EMP_ID` must not be another user's: the server refuses to start a request as an identity that would change who an existing id or employee id belongs to.
