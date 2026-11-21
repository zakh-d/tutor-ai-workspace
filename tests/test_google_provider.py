import httpx
import pytest
from app.google_provider import GoogleCalendar, GoogleError


def test_sync_follows_pages_and_returns_only_final_cursor():
    requests = []
    def handle(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, json={"items": [{"id": "a"}], "nextPageToken": "page2"})
        assert request.url.params['pageToken'] == 'page2'
        assert request.url.params['syncToken'] == 'old'
        return httpx.Response(200, json={"items": [{"id": "b"}], "nextSyncToken": "new"})
    provider = GoogleCalendar('secret', httpx.Client(transport=httpx.MockTransport(handle)))
    assert provider.sync('test@example.com', 'old') == ([{'id':'a'}, {'id':'b'}], 'new')
    assert requests[0].headers['authorization'] == 'Bearer secret'


@pytest.mark.parametrize('status,code', [(410,'sync_reset_required'),(401,'reauth_required'),(412,'external_conflict')])
def test_provider_errors(status, code):
    provider = GoogleCalendar('secret', httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status))))
    with pytest.raises(GoogleError) as exc:
        provider.sync('calendar')
    assert exc.value.code == code


def test_reschedule_refuses_external_change_or_attendees():
    for current in [{'etag':'new'}, {'etag':'old','attendees':[{'email':'student@example.com'}]}]:
        calls=[]
        def handle(request):
            calls.append(request.method)
            return httpx.Response(200,json=current)
        provider=GoogleCalendar('secret',httpx.Client(transport=httpx.MockTransport(handle)))
        with pytest.raises(GoogleError):
            provider.reschedule('calendar','event','old',{}, {})
        assert calls == ['GET']


def test_create_reconciles_lost_response():
    calls=[]
    def handle(request):
        calls.append(request.method)
        if request.method == 'POST':
            return httpx.Response(409)
        return httpx.Response(200,json={'id':'existing','extendedProperties':{'private':{'tutorOperation':'op'}}})
    provider=GoogleCalendar('secret',httpx.Client(transport=httpx.MockTransport(handle)))
    assert provider.create('calendar','op',{})['id']=='existing'
    assert calls==['POST','GET']


def test_conditional_update_retains_etag():
    calls=[]
    def handle(request):
        calls.append(request)
        if request.method=='GET':return httpx.Response(200,json={'etag':'old'})
        assert request.headers['if-match']=='old'
        assert request.url.params['sendUpdates']=='none'
        return httpx.Response(200,json={'etag':'new'})
    provider=GoogleCalendar('secret',httpx.Client(transport=httpx.MockTransport(handle)))
    assert provider.reschedule('calendar','event','old',{'dateTime':'start'},{'dateTime':'end'})['etag']=='new'
    assert len(calls)==2


def test_timing_rejects_dst_nonexistent_and_incorrect_offset():
    from app.calendar_api import EventMove,timing
    from app.errors import DomainError
    body=EventMove(expected_etag='a',start='2026-03-29T02:30:00+01:00',end='2026-03-29T04:00:00+02:00',timezone='Europe/Warsaw')
    with pytest.raises(DomainError):timing(body)


def test_timing_accepts_explicit_ambiguous_offset():
    from app.calendar_api import EventMove,timing
    body=EventMove(expected_etag='a',start='2026-10-25T02:30:00+02:00',end='2026-10-25T02:45:00+01:00',timezone='Europe/Warsaw')
    assert timing(body)['start']['timeZone']=='Europe/Warsaw'
