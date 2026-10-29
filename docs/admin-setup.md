# Review page setup (Cloudflare Tunnel and Access)

The review page runs inside the Greenfields app on this PC, at `http://127.0.0.1:8787`, and only answers on this
machine. To use it from anywhere at `https://greenfields-admin.gabrieltekken.com`:

- a **Cloudflare Tunnel** connects this PC to Cloudflare over an outgoing connection, so no router ports are opened;
- **Cloudflare Access** asks for your email and sends a one-time code before letting anyone through;
- the app checks Access's signed token again on every request.

Do these steps once. Cloudflare renames menus from time to time; the docs this was checked against are listed at the
end.

## 1. Turn on the one-time PIN login

1. In the Cloudflare dashboard, open **Zero Trust**.
2. Go to **Integrations › Identity providers**, select **Add new identity provider**, then **One-time PIN**.

## 2. Create the tunnel

1. Go to **Networking › Tunnels** (in older dashboards: **Zero Trust › Networks › Tunnels**) and select
   **Create a tunnel**.
2. Name it `greenfields-admin` and select **Create Tunnel**.
3. Choose **Windows**. The page shows how to download `cloudflared` and an install command that contains a long
   token. Run that command in **PowerShell opened as administrator**. It installs `cloudflared` as a Windows service
   that starts with Windows.
4. Wait until the tunnel shows as connected, then select **Continue**.

## 3. Protect the address with Access first

Do this before the address points anywhere, so there is never a moment when it is open.

1. Go to **Zero Trust › Access controls › Applications** and select **Create new application**, then
   **Self-hosted and private**.
2. Select **Add public hostname**: subdomain `greenfields-admin`, domain `gabrieltekken.com`.
3. Under **Access policies**, create a new policy:
   - Name: `Owner only`
   - Action: **Allow**
   - Include: **Emails** = your email address

   Do not add "Login Methods: One-time PIN" as an Include rule: that would let anyone with any email in.
4. Under identity providers, choose **One-time PIN**.
5. Select **Create**.

## 4. Point the address at the app

1. Open the `greenfields-admin` tunnel. On the **Routes** tab select **Add route**, then **Published application**.
2. Subdomain: `greenfields-admin`. Domain: `gabrieltekken.com`.
3. Service URL: `http://localhost:8787`.
4. Select **Add route**. Cloudflare creates the DNS record for you.

Because the Access application from step 3 already covers this address, it is protected from the moment it exists.

## 5. Tell the app

1. In **Zero Trust › Access controls › Applications**, select **Configure** on the new application and copy the
   **Application Audience (AUD) Tag** from **Additional settings**.
2. In **Zero Trust › Settings**, note your **team domain** (it looks like `yourteam.cloudflareaccess.com`).
3. Add these to `C:\Repo\Greenfields\.env`:

   ```
   CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
   CF_ACCESS_AUD=<the AUD tag>
   ADMIN_EMAIL=<the same email as in the policy>
   ```

4. Restart the app so it reads them:

   ```bash
   Restart-ScheduledTask -TaskName Greenfields
   ```

## 6. Check it

1. Open `https://greenfields-admin.gabrieltekken.com`. Cloudflare asks for your email and sends a code. After the code,
   you see **Pending changes**.
2. In a private window, try the address again without logging in, or with another email: you must not get past the
   Cloudflare login.
3. If the page says **Access is not configured**, one of the three `.env` values is missing. If it says **Forbidden**,
   the AUD tag, team domain or email does not match what Cloudflare sends.

## Trying the page without the tunnel

For a quick local look only, add `GREENFIELDS_ADMIN_DEV=1` to `.env`, restart the task and open
<http://127.0.0.1:8787>. This turns the login check off for this machine; requests that come through the tunnel are
still refused. Remove the line again afterwards.

## Sources (checked October 2026)

- Create a remotely-managed tunnel: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/>
- Self-hosted Access application: <https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/>
- Access policies: <https://developers.cloudflare.com/cloudflare-one/policies/access/>
- One-time PIN: <https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/>
- Validating the Access token (AUD tag): <https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/>
- Team domain: <https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/>
