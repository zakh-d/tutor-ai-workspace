"""Publish a checked commit and record its immutable image digest in a Git tag."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def run(*args, check=True):
    return subprocess.run(args, text=True, capture_output=True, check=check, timeout=1800)


def image_digest(reference):
    result = run('docker', 'buildx', 'imagetools', 'inspect', '--format', '{{json .Manifest}}', reference, check=False)
    if result.returncode:
        error = result.stderr.lower()
        if any(message in error for message in ('manifest unknown', 'name unknown', 'not found', 'no such manifest')):
            return None
        raise RuntimeError(f'Cannot inspect registry image: {result.stderr}')
    try:
        digest = json.loads(result.stdout)['digest']
    except (ValueError, KeyError, TypeError) as error:
        raise RuntimeError('Invalid registry manifest response') from error
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise RuntimeError(f'Invalid registry digest: {digest!r}')
    return digest


VERSION = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')


def next_version(previous, messages):
    if previous is None:
        return 'v0.1.0'
    major, minor, patch = map(int, VERSION.fullmatch(previous).groups())
    if re.search(r'(?m)^[a-zA-Z][\w-]*(?:\([^\r\n]*\))?!:', messages) or re.search(r'(?m)^BREAKING[ -]CHANGE:', messages):
        return f'v{major + 1}.0.0'
    if re.search(r'(?m)^feat(?:\([^\r\n]*\))?:', messages):
        return f'v{major}.{minor + 1}.0'
    return f'v{major}.{minor}.{patch + 1}'


def release_version(sha):
    tags = [tag for tag in run('git', 'tag', '--list', 'v*').stdout.splitlines() if VERSION.fullmatch(tag)]
    same_commit = [tag for tag in tags if run('git', 'rev-parse', f'{tag}^{{commit}}').stdout.strip() == sha]
    if len(same_commit) > 1:
        raise RuntimeError('Multiple semantic release tags point to this commit')
    if same_commit:
        return same_commit[0], True
    previous = max(tags, key=lambda tag: tuple(map(int, VERSION.fullmatch(tag).groups())), default=None)
    if previous and run('git', 'merge-base', '--is-ancestor', previous, sha, check=False).returncode:
        raise RuntimeError('Latest semantic release is not an ancestor; refusing an out-of-order release')
    revision = f'{previous}..{sha}' if previous else sha
    messages = run('git', 'log', '--format=%B', revision).stdout
    return next_version(previous, messages), False


def publish(env=os.environ):
    sha = env['GITHUB_SHA']
    repository = env['GITHUB_REPOSITORY'].lower()
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Expected a full Git commit SHA')
    if not re.fullmatch(r'[a-z0-9_.-]+/[a-z0-9_.-]+', repository):
        raise ValueError('Expected owner/repository')
    if run('git', 'rev-parse', 'HEAD').stdout.strip() != sha:
        raise RuntimeError('Checkout does not match the tested commit')
    image = f'ghcr.io/{repository}'
    reference = f'{image}:sha-{sha}'
    run('git', 'fetch', 'origin', '--tags')
    tag, existing = release_version(sha)
    version_reference = f'{image}:{tag}'
    digest = image_digest(reference)
    if existing:
        annotation = run('git', 'for-each-ref', '--format=%(contents)', f'refs/tags/{tag}').stdout
        if not digest or f'Image: {image}@{digest}\n' not in annotation:
            raise RuntimeError('Existing release tag and registry digest disagree')
    if digest is None:
        with tempfile.TemporaryDirectory() as directory:
            metadata = Path(directory) / 'metadata.json'
            run('docker', 'buildx', 'build', '--push', '--platform', env.get('IMAGE_PLATFORMS', 'linux/amd64'),
                '--tag', reference, '--metadata-file', str(metadata),
                '--label', f'org.opencontainers.image.source=https://github.com/{repository}',
                '--label', f'org.opencontainers.image.revision={sha}',
                '--build-arg', f"VITE_KEYCLOAK_URL={env['VITE_KEYCLOAK_URL']}",
                '--build-arg', f"VITE_KEYCLOAK_REALM={env['VITE_KEYCLOAK_REALM']}",
                '--build-arg', f"VITE_KEYCLOAK_CLIENT_ID={env['VITE_KEYCLOAK_CLIENT_ID']}", '.')
            digest = json.loads(metadata.read_text())['containerimage.digest']
        if image_digest(reference) != digest:
            raise RuntimeError('Published image digest verification failed')
    version_digest = image_digest(version_reference)
    if version_digest is not None and version_digest != digest:
        raise RuntimeError('Semantic image tag already has a different digest')
    if existing and version_digest is None:
        raise RuntimeError('Existing semantic release image is missing')
    if version_digest is None:
        run('docker', 'buildx', 'imagetools', 'create', '--prefer-index=false',
            '--tag', version_reference, f'{image}@{digest}')
        if image_digest(version_reference) != digest:
            raise RuntimeError('Semantic image digest verification failed')
    if not existing:
        run('git', 'config', 'user.name', 'github-actions[bot]')
        run('git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
        run('git', 'tag', '-a', tag, sha, '-m', f'Image: {image}@{digest}\nSource: {sha}')
        run('git', 'push', 'origin', f'refs/tags/{tag}')
    summary = f'Image: `{image}@{digest}`\n\nImage tag: `{version_reference}`\n\nSource image tag: `{reference}`\n\nGit tag: `{tag}`\n'
    print(summary)
    if env.get('GITHUB_STEP_SUMMARY'):
        with open(env['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(summary)


if __name__ == '__main__':
    try:
        publish()
    except subprocess.CalledProcessError as error:
        print(error.stdout or '')
        print(error.stderr or '')
        raise
