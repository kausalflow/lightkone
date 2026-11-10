"""Read and write a Lightkone library from Python: the same files the web app keeps in your storage."""

__version__ = "0.2.0"

from lightkone.library import BIB_PATH, LIBRARY_PATH, Library
from lightkone.storage import (
    FolderStorage,
    GitHubStorage,
    S3Storage,
    Storage,
    StorageError,
)

__all__ = [
    "Library",
    "Storage",
    "FolderStorage",
    "S3Storage",
    "GitHubStorage",
    "StorageError",
    "LIBRARY_PATH",
    "BIB_PATH",
]
