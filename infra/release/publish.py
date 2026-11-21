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
    tag = f'build-{sha}'
    run('git', 'fetch', 'origin', '--tags')
    existing = run('git', 'rev-parse', '--verify', f'refs/tags/{tag}', check=False)
    if existing.returncode == 0:
        target = run('git', 'rev-parse', f'{tag}^{{commit}}').stdout.strip()
        if target != sha:
            raise RuntimeError('Existing release tag points to another commit')
    digest = image_digest(reference)
    if existing.returncode == 0:
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
    if existing.returncode != 0:
        run('git', 'config', 'user.name', 'github-actions[bot]')
        run('git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
        run('git', 'tag', '-a', tag, sha, '-m', f'Image: {image}@{digest}\nSource: {sha}')
        run('git', 'push', 'origin', f'refs/tags/{tag}')
    summary = f'Image: `{image}@{digest}`\n\nImage tag: `{reference}`\n\nGit tag: `{tag}`\n'
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
