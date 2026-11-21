"""Google Calendar transport. No application credentials or persistence live here."""
from __future__ import annotations
import hashlib
import httpx


class GoogleError(Exception):
    def __init__(self, code: str, status: int, retryable: bool = False):
        super().__init__(code)
        self.code, self.status, self.retryable = code, status, retryable


class GoogleCalendar:
    def __init__(self, access_token: str, client: httpx.Client | None = None):
        self.token = access_token
        self.client = client or httpx.Client(timeout=30)
        self.owned_client = client is None

    def close(self):
        if self.owned_client:
            self.client.close()

    def request(self, method, path, **kwargs):
        headers = {"Authorization": f"Bearer {self.token}", **kwargs.pop("headers", {})}
        response = self.client.request(method, "https://www.googleapis.com/calendar/v3" + path, headers=headers, **kwargs)
        if response.is_error:
            codes = {401: "reauth_required", 403: "provider_forbidden", 410: "sync_reset_required", 412: "external_conflict", 409: "already_exists", 404: "not_found"}
            raise GoogleError(codes.get(response.status_code, "provider_unavailable"), response.status_code, response.status_code == 429 or response.status_code >= 500)
        return response.json() if response.content else {}

    @staticmethod
    def calendar_path(calendar_id):
        from urllib.parse import quote
        return "/calendars/" + quote(calendar_id, safe="") + "/events"

    def calendars(self):
        items, token = [], None
        while True:
            data = self.request("GET", "/users/me/calendarList", params={"pageToken": token} if token else {})
            items.extend(data.get("items", []))
            token = data.get("nextPageToken")
            if not token:
                return items

    def sync(self, calendar_id, sync_token=None):
        params = {"showDeleted": "true", "maxResults": 2500}
        if sync_token:
            params["syncToken"] = sync_token
        items = []
        while True:
            data = self.request("GET", self.calendar_path(calendar_id), params=params)
            items.extend(data.get("items", []))
            if data.get("nextPageToken"):
                params["pageToken"] = data["nextPageToken"]
            else:
                return items, data.get("nextSyncToken")

    def occurrences(self, calendar_id, start, end):
        params = {"singleEvents": "true", "timeMin": start.isoformat(), "timeMax": end.isoformat(), "maxResults": 2500}
        items = []
        while True:
            data = self.request("GET", self.calendar_path(calendar_id), params=params)
            items.extend(data.get("items", []))
            if not data.get("nextPageToken"):
                return items
            params["pageToken"] = data["nextPageToken"]

    def get(self, calendar_id, event_id):
        from urllib.parse import quote
        return self.request("GET", self.calendar_path(calendar_id) + "/" + quote(event_id, safe=""))

    def create(self, calendar_id, operation_id, event):
        event_id = hashlib.sha256(str(operation_id).encode()).hexdigest()
        body = {**event, "id": event_id, "attendees": [], "extendedProperties": {"private": {"tutorOperation": str(operation_id)}}}
        try:
            return self.request("POST", self.calendar_path(calendar_id), params={"sendUpdates": "none"}, json=body)
        except GoogleError as exc:
            if exc.status != 409:
                raise
            existing = self.get(calendar_id, event_id)
            if existing.get("extendedProperties", {}).get("private", {}).get("tutorOperation") != str(operation_id):
                raise GoogleError("external_conflict", 409)
            return existing

    def reschedule(self, calendar_id, event_id, etag, start, end):
        from urllib.parse import quote
        current = self.get(calendar_id, event_id)
        if current.get("etag") != etag or current.get("attendees"):
            raise GoogleError("external_conflict", 412)
        return self.request("PATCH", self.calendar_path(calendar_id) + "/" + quote(event_id, safe=""), headers={"If-Match": etag}, params={"sendUpdates": "none"}, json={"start": start, "end": end})

    def delete(self, calendar_id, event_id, etag):
        from urllib.parse import quote
        return self.request("DELETE", self.calendar_path(calendar_id) + "/" + quote(event_id, safe=""), headers={"If-Match": etag}, params={"sendUpdates": "none"})


def exchange_token(client_id, client_secret, *, code=None, redirect_uri=None, refresh_token=None, client=None):
    data = {"client_id": client_id, "client_secret": client_secret}
    if refresh_token:
        data.update(grant_type="refresh_token", refresh_token=refresh_token)
    else:
        data.update(grant_type="authorization_code", code=code, redirect_uri=redirect_uri)
    owned = client is None
    client = client or httpx.Client(timeout=30)
    try:
        response = client.post("https://oauth2.googleapis.com/token", data=data)
        if response.is_error:
            raise GoogleError("reauth_required" if response.status_code in (400, 401) else "provider_unavailable", response.status_code, response.status_code >= 500)
        return response.json()
    finally:
        if owned:
            client.close()
