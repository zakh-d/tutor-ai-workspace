"""Bounded standalone document conversion; launched only by the worker."""

def install_filter():
    # Load trusted converter modules before denying process creation (including native code).
    import ctypes
    sec=ctypes.CDLL('libseccomp.so.2',use_errno=True)
    sec.seccomp_init.argtypes=[ctypes.c_uint32];sec.seccomp_init.restype=ctypes.c_void_p
    sec.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p];sec.seccomp_syscall_resolve_name.restype=ctypes.c_int
    sec.seccomp_rule_add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint]
    sec.seccomp_load.argtypes=[ctypes.c_void_p]
    sec.seccomp_release.argtypes=[ctypes.c_void_p]
    ctx=sec.seccomp_init(0x7fff0000)
    if not ctx:raise RuntimeError('sandbox unavailable')
    try:
        for name in ('socket','socketpair','connect','bind','listen','accept','accept4','fork','vfork','clone','clone3','execve','execveat'):
            number=sec.seccomp_syscall_resolve_name(name.encode())
            if number>=0 and sec.seccomp_rule_add(ctx,0x50001,number,0)!=0:raise RuntimeError('sandbox rule failed')
        if sec.seccomp_load(ctx)!=0:raise RuntimeError('sandbox unavailable')
    finally:sec.seccomp_release(ctx)

def main():
    import resource,sys
    from pathlib import Path
    resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2))
    resource.setrlimit(resource.RLIMIT_CPU,(110,110))
    resource.setrlimit(resource.RLIMIT_FSIZE,(5*1024**2,5*1024**2))
    from markitdown.converters import PdfConverter,DocxConverter,PptxConverter
    from markitdown import StreamInfo
    # Dispatch only the three explicitly supported local converters. This avoids
    # optional remote/plugin paths and the generic MIME detector's native threads.
    source=Path(sys.argv[1]);extension=source.suffix.lower()
    converter={'.pdf':PdfConverter,'.docx':DocxConverter,'.pptx':PptxConverter}[extension]()
    install_filter()
    with source.open('rb') as file:
        text=converter.convert(file,StreamInfo(extension=extension)).text_content
    sys.stdout.write(text)

if __name__=='__main__':main()
