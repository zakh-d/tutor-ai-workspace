from uuid import uuid4

STATUS = {'unauthenticated':401,'forbidden':403,'not_found':404,'revision_conflict':409,'idempotency_conflict':409,'invalid_state':409,'external_conflict':409,'undo_not_supported':409,'precondition_required':428,'validation_error':422,'payload_too_large':413,'rate_limited':429,'provider_unavailable':503,'no_extractable_text':422,'text_unavailable':422}
class DomainError(Exception):
    def __init__(self, code, message, details=None, retryable=False):
        self.code,self.message,self.details,self.retryable=code,message,details or {},retryable
    def payload(self):
        return {'error':{'code':self.code,'message':self.message,'retryable':self.retryable,'details':self.details},'request_id':str(uuid4())}

def require(value, code='validation_error', message='Invalid request.'):
    if not value:
        raise DomainError(code,message)
