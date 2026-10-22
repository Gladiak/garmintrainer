import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("deploy_remote", Path(__file__).parents[1] / "deploy/remote.py")
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class DeploySafetyTests(unittest.TestCase):
    def test_new_secrets_are_private_and_preserved_on_update(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(remote.subprocess, "run", return_value=Mock(returncode=1)):
                remote.ensure_secrets(root)
            files = list((root / "shared/secrets").iterdir())
            before = {file.name: file.read_bytes() for file in files}
            remote.ensure_secrets(root)
            self.assertEqual(before, {file.name: file.read_bytes() for file in files})
            self.assertEqual(len(before["encryption_key"]), 32)
            for file in files:
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)

    def test_partial_credentials_are_never_regenerated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secrets = root / "shared/secrets"
            secrets.mkdir(parents=True)
            (secrets / "db_password").write_bytes(b"original")
            with self.assertRaisesRegex(RuntimeError, "incompleti"):
                remote.ensure_secrets(root)
            self.assertEqual((secrets / "db_password").read_bytes(), b"original")
            self.assertEqual(len(list(secrets.iterdir())), 1)

    def test_orphaned_database_volume_does_not_get_new_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(remote.subprocess, "run", return_value=Mock(returncode=0)):
                with self.assertRaisesRegex(RuntimeError, "database senza secret"):
                    remote.ensure_secrets(root)
            self.assertEqual(list((root / "shared/secrets").iterdir()), [])

    def test_compose_ignores_environment_files_and_uses_vps_identity(self):
        with patch.dict(os.environ, {"COMPOSE_FILE": "unexpected.yaml", "COMPOSE_ENV_FILES": "private-file"}):
            env = remote.environment(Path("/home/ubuntu/app"), "trainer.example.org", Path("/releases/abc"))
        self.assertNotIn("COMPOSE_FILE", env)
        self.assertNotIn("COMPOSE_ENV_FILES", env)
        self.assertEqual(env["COMPOSE_DISABLE_ENV_FILE"], "true")
        self.assertEqual(env["RELEASE_ID"], "abc")


if __name__ == "__main__":
    unittest.main()
