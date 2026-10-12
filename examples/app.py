"""A small demo CLI: the same kind of call chain as app.js, in Python."""
import os
import sys


def main():
    run_job()


def run_job():
    try:
        execute()
    except Exception:
        raise


def execute():
    if not is_ready():
        raise RuntimeError('not ready')
    charge()


def is_ready():
    return False


def charge():
    if not confirm_charge():
        sys.exit(1)
    raise RuntimeError('charge failed')


def confirm_charge():
    return False


def load_api_key():
    # reads the API key from the environment first, then a local settings file
    return os.environ.get('SYS1GREP_API_KEY') or read_settings_file()


def read_settings_file():
    return ''


def try_optional_step():
    try:
        risky_step()
    except Exception:
        pass  # ignored: optional, not fatal


def risky_step():
    return True
