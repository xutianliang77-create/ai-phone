import json
import unittest
from pathlib import Path

from communication_contract import parse_command, parse_event

FIXTURES = Path(__file__).parents[1] / "fixtures" / "communication-v1"


class CommunicationContractGoldenTest(unittest.TestCase):
    def test_python_decodes_shared_v1_fixtures(self) -> None:
        command = fixture("command.json")
        event = fixture("event.json")

        self.assertEqual(parse_command(command), command)
        self.assertEqual(parse_event(event), event)
        self.assertEqual(event["playbackId"], "playback_001")

    def test_additive_fields_are_compatible_and_versions_are_strict(self) -> None:
        event = fixture("event.json")
        event["additiveField"] = "v1-compatible"
        self.assertEqual(parse_event(event)["additiveField"], "v1-compatible")

        event["contractVersion"] = 2
        with self.assertRaisesRegex(ValueError, "contractVersion"):
            parse_event(event)


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
