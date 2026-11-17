import hashlib
import io
import json
import unittest
import zipfile

from pack import archive_name, payload

INTEL = 'Intel.ML.OnnxRuntime.EP.OpenVINO'


def package(files):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as source:
        for name, content in files.items():
            source.writestr(name, content)
    return zipfile.ZipFile(data)


def runtime(rid):
    native = 'foundry_local.dll' if rid.startswith('win-') else 'libfoundry_local.so'
    manifest = {'rid': rid, 'native': {'file_name': native, 'sha256': hashlib.sha256(b'native').hexdigest()},
                'host': {'file_name': 'foundry-local-host', 'sha256': hashlib.sha256(b'host').hexdigest()}}
    return package({'LICENSE': b'Microsoft license', f'runtimes/{rid}/native/{native}': b'native',
                    f'runtimes/{rid}/native/foundry-local-host': b'host',
                    f'runtimes/{rid}/native/foundry-local-runtime.json': json.dumps(manifest),
                    f'runtimes/{rid}/native/libonnxruntime.so': b'ORT'})


def intel(extra=None, license='MIT'):
    return package({f'{INTEL}.nuspec': f'<package><metadata><license type="expression">{license}</license></metadata></package>',
                    'README.md': b'Intel readme',
                    'runtimes/win-x64/native/onnxruntime_providers_openvino_plugin.dll': b'signed Intel bytes',
                    'runtimes/win-x64/native/third-party-programs.txt': b'Intel notices', **(extra or {})})


class OpenVinoPackaging(unittest.TestCase):
    def test_new_name_preserves_the_published_windows_archive(self):
        self.assertEqual(archive_name('win-x64'), 'foundry-local-win-x64-openvino-1-8-1.zip')
        self.assertEqual(archive_name('win-arm64'), 'foundry-local-win-arm64.zip')

    def test_windows_keeps_intel_bytes_and_licenses_in_a_separate_directory(self):
        with runtime('win-x64') as base, intel() as ep:
            files, links = payload('win-x64', [('Microsoft.AI.Foundry.Local.Runtime', base), (INTEL, ep)])
        self.assertEqual(files['lib/openvino/onnxruntime_providers_openvino_plugin.dll'][0], b'signed Intel bytes')
        self.assertEqual(files['lib/openvino/third-party-programs.txt'][0], b'Intel notices')
        self.assertIn(f'licenses/{INTEL}/{INTEL}.nuspec', files)
        self.assertIn(f'licenses/{INTEL}/README.md', files)
        self.assertEqual(files['lib/foundry_local.dll'][0], b'native')
        self.assertEqual(links, {})

    def test_other_platforms_do_not_receive_the_windows_intel_package(self):
        with runtime('linux-x64') as base, intel() as ep:
            files, _ = payload('linux-x64', [('Microsoft.AI.Foundry.Local.Runtime', base), (INTEL, ep)])
        self.assertFalse(any('openvino' in name.lower() for name in files))

    def test_missing_or_changed_license_metadata_is_rejected(self):
        with runtime('win-x64') as base, intel(license='unknown') as ep:
            with self.assertRaisesRegex(ValueError, 'license'):
                payload('win-x64', [('Microsoft.AI.Foundry.Local.Runtime', base), (INTEL, ep)])

    def test_nested_native_paths_are_rejected(self):
        with runtime('win-x64') as base, intel({'runtimes/win-x64/native/../evil.dll': b'bad'}) as ep:
            with self.assertRaisesRegex(ValueError, 'native path'):
                payload('win-x64', [('Microsoft.AI.Foundry.Local.Runtime', base), (INTEL, ep)])


if __name__ == '__main__':
    unittest.main()
