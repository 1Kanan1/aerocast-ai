from alembic.config import Config
from alembic.script import ScriptDirectory

from app.db.migrate import ALEMBIC_INI


def test_the_revision_history_has_one_head() -> None:
    script = ScriptDirectory.from_config(Config(str(ALEMBIC_INI)))

    assert len(script.get_heads()) == 1
