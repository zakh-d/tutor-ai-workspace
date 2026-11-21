"""Pure scoring and upload boundaries, without alternate database/auth implementations."""
from uuid import uuid4
import pytest
from pydantic import ValidationError
from app.schemas import Homework,Task
from app.service import score,validate_answers,validate_assessment
from app.storage import chunks,detect
from app.errors import DomainError

def question():
    qid,a,b=[str(uuid4()) for _ in range(3)]
    return {'id':qid,'type':'multiple_choice','prompt':'Select','points':4,'required':True,'options':[{'id':a,'text':'A'},{'id':b,'text':'B'}],'correct_option_ids':[a]}
def test_exact_set_scoring_and_required_answers():
    q=question();content={'questions':[q]}
    assert score(content,[{'question_id':q['id'],'value':q['correct_option_ids']}])=={q['id']:4}
    assert score(content,[{'question_id':q['id'],'value':[o['id'] for o in q['options']]}])=={q['id']:0}
    with pytest.raises(DomainError):validate_answers(content,[],{},True)
    with pytest.raises(DomainError):validate_answers(content,[{'question_id':q['id'],'value':[q['correct_option_ids'][0]]*2}],{})
def test_assessment_objective_score_cannot_change():
    q=question()
    with pytest.raises(DomainError):validate_assessment({'questions':[q]},{'items':[{'question_id':q['id'],'awarded_points':3}]},{q['id']:4},True)
def test_strict_schemas_and_aware_time():
    with pytest.raises(ValidationError):Task(title='Task',due_at='2026-01-01T00:00:00')
    with pytest.raises(ValidationError):Task(title='Task',workspace_id=str(uuid4()))
    q=question();q['correct_option_ids']=[str(uuid4())]
    with pytest.raises(ValidationError):Homework(title='Test',instructions='',questions=[q])
def test_chunk_bounds_and_file_signature():
    result=chunks('# Heading\n\n'+('x'*6000))
    assert ''.join(c['text'] for c in result).endswith('x'*6000)
    assert all(len(c['text'])<=2000 for c in result)
    assert [c['ordinal'] for c in result]==list(range(len(result)))
    with pytest.raises(DomainError):detect('safe.pdf',b'MZ executable')
    with pytest.raises(DomainError):detect('macro.docm',b'PK')
    with pytest.raises(DomainError):detect('text.txt',b'\x00')

def test_extraction_normalization_and_output_bound():
    from app.worker import extract
    assert extract(b'A\r\nB','notes.txt')=='A\nB'
    with pytest.raises(DomainError) as exc:extract(b'\xff','bad.txt')
    assert exc.value.code=='validation_error'
    with pytest.raises(DomainError) as exc:extract(b'x'*(5*1024**2+1),'large.md')
    assert exc.value.code=='payload_too_large'

def test_mcp_named_identifiers_and_filter_contract():
    import asyncio
    from app.mcp import mcp
    async def inspect_tools():
        tools=await mcp.get_tools()
        assert 'student_id' in tools['students_get'].parameters['properties']
        assert 'record_id' not in tools['students_get'].parameters['properties']
        assert {'archived','student_id','status','due_before'} <= set(tools['tasks_list'].parameters['properties'])
        assert 'material_version_id' in tools['materials_retry_conversion'].parameters['properties']
    asyncio.run(inspect_tools())

def test_native_sandbox_converts_docx():
    import io,zipfile
    from app.worker import extract
    # Minimal valid DOCX exercises the actual local converter subprocess/filter.
    raw=io.BytesIO()
    with zipfile.ZipFile(raw,'w') as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Native sandbox conversion works.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
    assert 'Native sandbox conversion works.' in extract(raw.getvalue(),'fixture.docx')

def test_native_sandbox_denies_network_and_process_creation():
    import subprocess,sys,os
    result=subprocess.run([sys.executable,'-c',"""
import ctypes,errno,os
from app.conversion import install_filter
install_filter()
lib=ctypes.CDLL(None,use_errno=True)
assert lib.socket(2,1,0)==-1 and ctypes.get_errno()==errno.EPERM
try:os.fork()
except PermissionError:pass
else:raise AssertionError('fork was allowed')
try:os.execve('/bin/true',['true'],{})
except PermissionError:pass
else:raise AssertionError('exec was allowed')
"""],capture_output=True,env={**os.environ,'PYTHONPATH':'backend'},timeout=10)
    assert result.returncode==0,result.stderr.decode()

def test_native_sandbox_converts_pdf():
    from app.worker import extract
    stream=b'BT /F1 12 Tf 72 720 Td (Native PDF conversion works.) Tj ET'
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
    raw=b'%PDF-1.4\n';offsets=[0]
    for i,obj in enumerate(objects,1):
        offsets.append(len(raw));raw+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
    xref=len(raw);raw+=b'xref\n0 6\n0000000000 65535 f \n'
    for offset in offsets[1:]:raw+=f'{offset:010d} 00000 n \n'.encode()
    raw+=b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'
    assert 'Native PDF conversion works.' in extract(raw,'fixture.pdf')

def test_native_sandbox_converts_pptx():
    import io
    from pptx import Presentation
    from app.worker import extract
    deck=Presentation();slide=deck.slides.add_slide(deck.slide_layouts[1])
    slide.shapes.title.text='Native slide conversion works.'
    raw=io.BytesIO();deck.save(raw)
    assert 'Native slide conversion works.' in extract(raw.getvalue(),'fixture.pptx')
