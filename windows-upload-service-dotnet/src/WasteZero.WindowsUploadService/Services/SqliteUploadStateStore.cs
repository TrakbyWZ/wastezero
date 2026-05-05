using Microsoft.Data.Sqlite;

namespace WasteZero.WindowsUploadService.Services;

/// <summary>
/// Persists per-file upload outcomes in SQLite (SUCCESS, FAIL with retry_after, SKIP).
/// </summary>
public sealed class SqliteUploadStateStore : IUploadStateStore
{
    private readonly object _gate = new();
    private string? _activeDbPath;

    public void EnsureDatabase(string absoluteDatabasePath)
    {
        lock (_gate)
        {
            var dir = Path.GetDirectoryName(absoluteDatabasePath);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);

            _activeDbPath = absoluteDatabasePath;
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "CREATE TABLE IF NOT EXISTS file_upload_state (" +
                "file_path TEXT NOT NULL PRIMARY KEY, " +
                "filename TEXT NOT NULL, " +
                "sent_at TEXT NOT NULL, " +
                "status TEXT NOT NULL, " +
                "error_message TEXT NULL, " +
                "retry_after TEXT NULL" +
                "); " +
                "CREATE INDEX IF NOT EXISTS idx_file_upload_state_sent_at ON file_upload_state(sent_at);";
            cmd.ExecuteNonQuery();
        }
    }

    public void TrimState(int maxRecords, int maxStateAgeDays)
    {
        if (maxRecords <= 0 && maxStateAgeDays <= 0)
            return;

        lock (_gate)
        {
            using var conn = Open();
            if (maxStateAgeDays > 0)
            {
                var cutoff = DateTimeOffset.UtcNow.AddDays(-maxStateAgeDays).ToString("O");
                using var del = conn.CreateCommand();
                del.CommandText = "DELETE FROM file_upload_state WHERE sent_at < @cutoff;";
                del.Parameters.AddWithValue("@cutoff", cutoff);
                del.ExecuteNonQuery();
            }

            if (maxRecords > 0)
            {
                using var countCmd = conn.CreateCommand();
                countCmd.CommandText = "SELECT COUNT(*) FROM file_upload_state;";
                var count = Convert.ToInt64(countCmd.ExecuteScalar());
                var toDelete = count - maxRecords;
                if (toDelete > 0)
                {
                    using var del = conn.CreateCommand();
                    del.CommandText =
                        "DELETE FROM file_upload_state WHERE file_path IN (" +
                        "SELECT file_path FROM file_upload_state ORDER BY sent_at ASC LIMIT @lim" +
                        ");";
                    del.Parameters.AddWithValue("@lim", toDelete);
                    del.ExecuteNonQuery();
                }
            }
        }
    }

    public bool IsEligibleForUpload(string normalizedPath)
    {
        lock (_gate)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "SELECT status, retry_after FROM file_upload_state WHERE file_path = @p LIMIT 1;";
            cmd.Parameters.AddWithValue("@p", normalizedPath);
            using var r = cmd.ExecuteReader();
            if (!r.Read())
                return true;

            var status = r.GetString(0);
            if (status is "SUCCESS" or "SKIP")
                return false;

            if (status != "FAIL")
                return true;

            if (r.IsDBNull(1))
                return true;

            var retryAfter = r.GetString(1);
            if (!DateTimeOffset.TryParse(retryAfter, out var retryAt))
                return true;

            return DateTimeOffset.UtcNow >= retryAt;
        }
    }

    public void MarkSent(string normalizedPath, string filename)
    {
        Upsert(normalizedPath, filename, "SUCCESS", null, null);
    }

    public void MarkSkipped(string normalizedPath, string filename, string? errorMessage)
    {
        var err = Truncate(errorMessage, 1000);
        Upsert(normalizedPath, filename, "SKIP", err, null);
    }

    public void MarkFailed(string normalizedPath, string filename, string? errorMessage, int retryAfterMs)
    {
        var err = Truncate(errorMessage, 1000);
        var retryAfter = DateTimeOffset.UtcNow.AddMilliseconds(retryAfterMs).ToString("O");
        Upsert(normalizedPath, filename, "FAIL", err, retryAfter);
    }

    private void Upsert(string normalizedPath, string filename, string status, string? errorMessage, string? retryAfter)
    {
        lock (_gate)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "INSERT INTO file_upload_state (file_path, filename, sent_at, status, error_message, retry_after) " +
                "VALUES (@path, @name, @sent, @status, @err, @retry) " +
                "ON CONFLICT(file_path) DO UPDATE SET " +
                "filename = excluded.filename, " +
                "sent_at = excluded.sent_at, " +
                "status = excluded.status, " +
                "error_message = excluded.error_message, " +
                "retry_after = excluded.retry_after;";
            cmd.Parameters.AddWithValue("@path", normalizedPath);
            cmd.Parameters.AddWithValue("@name", filename);
            cmd.Parameters.AddWithValue("@sent", DateTimeOffset.UtcNow.ToString("O"));
            cmd.Parameters.AddWithValue("@status", status);
            cmd.Parameters.AddWithValue("@err", (object?)errorMessage ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@retry", (object?)retryAfter ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
    }

    private SqliteConnection Open()
    {
        if (string.IsNullOrEmpty(_activeDbPath))
            throw new InvalidOperationException("Database path not initialized.");

        var b = new SqliteConnectionStringBuilder
        {
            DataSource = _activeDbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
        };
        var conn = new SqliteConnection(b.ToString());
        conn.Open();
        using (var pragma = conn.CreateCommand())
        {
            pragma.CommandText = "PRAGMA busy_timeout = 30000;";
            pragma.ExecuteNonQuery();
        }

        return conn;
    }

    private static string? Truncate(string? s, int max)
    {
        if (string.IsNullOrEmpty(s)) return s;
        return s.Length <= max ? s : s.Substring(0, max);
    }
}
