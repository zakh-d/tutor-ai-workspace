import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_publish', Path(__file__).with_name('publish.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64
ENV = {'GITHUB_SHA': SHA, 'GITHUB_REPOSITORY': 'Owner/App',
       'VITE_KEYCLOAK_URL': 'https://auth.zahk.tech',
       'VITE_KEYCLOAK_REALM': 'tutor', 'VITE_KEYCLOAK_CLIENT_ID': 'tutor-web'}


class PublishTests(unittest.TestCase):
    def scenario(self, *, tag=False, digest=DIGEST, wrong_commit=False, wrong_digest=False, fail_build=False):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            output, code = '', 0
            if args == ('git', 'rev-parse', 'HEAD'):
                output = 'c' * 40 if wrong_commit else SHA
            elif args[:3] == ('git', 'rev-parse', '--verify'):
                code = 0 if tag else 1
            elif args[:2] == ('git', 'rev-parse'):
                output = SHA
            elif args[:2] == ('git', 'for-each-ref'):
                output = f'Image: ghcr.io/owner/app@{"bad" if wrong_digest else DIGEST}\n'
            elif args[:3] == ('docker', 'buildx', 'build'):
                if fail_build:
                    raise subprocess.CalledProcessError(1, args, stderr='build failed')
                Path(args[args.index('--metadata-file') + 1]).write_text(json.dumps({'containerimage.digest': DIGEST}))
            return subprocess.CompletedProcess(args, code, output, '')
        return calls, command

    def test_first_publish_builds_before_tag_and_push(self):
        calls, command = self.scenario(digest=None)
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest', side_effect=[None, DIGEST]):
            release.publish(ENV)
        build = next(i for i, c in enumerate(calls) if c[:3] == ('docker', 'buildx', 'build'))
        tag = next(i for i, c in enumerate(calls) if c[:2] == ('git', 'tag'))
        self.assertLess(build, tag)
        self.assertIn(('git', 'push', 'origin', f'refs/tags/build-{SHA}'), calls)
        self.assertIn(f'VITE_KEYCLOAK_URL={ENV["VITE_KEYCLOAK_URL"]}', calls[build])

    def test_retry_after_image_push_reuses_digest(self):
        calls, command = self.scenario()
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest', return_value=DIGEST):
            release.publish(ENV)
        self.assertFalse(any(c[:3] == ('docker', 'buildx', 'build') for c in calls))
        self.assertTrue(any(c[:2] == ('git', 'push') for c in calls))

    def test_completed_rerun_does_not_rebuild_or_push(self):
        calls, command = self.scenario(tag=True)
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest', return_value=DIGEST):
            release.publish(ENV)
        self.assertFalse(any(c[:2] in (('git', 'push'), ('git', 'tag')) or c[:3] == ('docker', 'buildx', 'build') for c in calls))

    def test_digest_mismatch_fails_without_push(self):
        calls, command = self.scenario(tag=True, wrong_digest=True)
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest', return_value=DIGEST):
            with self.assertRaisesRegex(RuntimeError, 'disagree'):
                release.publish(ENV)
        self.assertFalse(any(c[:2] == ('git', 'push') for c in calls))

    def test_wrong_checkout_fails_before_registry_access(self):
        _, command = self.scenario(wrong_commit=True)
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest') as inspect:
            with self.assertRaisesRegex(RuntimeError, 'tested commit'):
                release.publish(ENV)
            inspect.assert_not_called()

    def test_build_failure_never_creates_git_tag(self):
        calls, command = self.scenario(fail_build=True)
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest', return_value=None):
            with self.assertRaises(subprocess.CalledProcessError):
                release.publish(ENV)
        self.assertFalse(any(c[:2] in (('git', 'tag'), ('git', 'push')) for c in calls))

    def test_registry_auth_failure_is_not_treated_as_missing_image(self):
        with patch.object(release, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'unauthorized')):
            with self.assertRaisesRegex(RuntimeError, 'Cannot inspect'):
                release.image_digest('example')

    def test_registry_manifest_missing_allows_initial_build(self):
        with patch.object(release, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'manifest unknown')):
            self.assertIsNone(release.image_digest('example'))

    def test_registry_digest_must_be_valid(self):
        with patch.object(release, 'run', return_value=subprocess.CompletedProcess([], 0, 'invalid', '')):
            with self.assertRaisesRegex(RuntimeError, 'Invalid registry manifest response'):
                release.image_digest('example')

    def test_missing_image_with_existing_release_fails(self):
        calls, command = self.scenario(tag=True)
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'disagree'):
                release.publish(ENV)
        self.assertFalse(any(c[:3] == ('docker', 'buildx', 'build') for c in calls))

    def test_published_digest_must_match_registry_before_tagging(self):
        calls, command = self.scenario(digest=None)
        with patch.object(release, 'run', side_effect=command), patch.object(release, 'image_digest', side_effect=[None, 'sha256:' + 'c' * 64]):
            with self.assertRaisesRegex(RuntimeError, 'verification failed'):
                release.publish(ENV)
        self.assertFalse(any(c[:2] == ('git', 'tag') for c in calls))

    def test_structured_manifest_digest_is_used(self):
        with patch.object(release, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps({'digest': DIGEST, 'manifests': []}), '')):
            self.assertEqual(release.image_digest('example'), DIGEST)

    def test_real_git_remote_receives_annotated_tag_and_rerun_is_safe(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / 'remote.git'
            work = root / 'work'
            def git(*args):
                return subprocess.run(('git', *args), cwd=work, check=True, text=True, capture_output=True)
            subprocess.run(('git', 'init', '--bare', str(remote)), check=True, capture_output=True)
            work.mkdir()
            git('init')
            git('config', 'user.name', 'Release test')
            git('config', 'user.email', 'test@example.invalid')
            (work / 'source.txt').write_text('checked source')
            git('add', 'source.txt')
            git('commit', '-m', 'Source')
            git('remote', 'add', 'origin', str(remote))
            git('push', 'origin', 'HEAD:main')
            sha = git('rev-parse', 'HEAD').stdout.strip()
            previous = Path.cwd()
            try:
                os.chdir(work)
                with patch.object(release, 'image_digest', return_value=DIGEST):
                    release.publish({**ENV, 'GITHUB_SHA': sha})
                    release.publish({**ENV, 'GITHUB_SHA': sha})
            finally:
                os.chdir(previous)
            self.assertEqual(git('cat-file', '-t', f'build-{sha}').stdout.strip(), 'tag')
            self.assertEqual(git('rev-parse', f'build-{sha}^{{commit}}').stdout.strip(), sha)
            remote_tag = subprocess.run(('git', '--git-dir', str(remote), 'cat-file', '-p', f'build-{sha}'), check=True, text=True, capture_output=True).stdout
            self.assertIn(f'Image: ghcr.io/owner/app@{DIGEST}', remote_tag)
