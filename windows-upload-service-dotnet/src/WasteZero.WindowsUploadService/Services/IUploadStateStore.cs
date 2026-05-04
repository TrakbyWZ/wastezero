namespace WasteZero.WindowsUploadService.Services;

public interface IUploadStateStore
{
    void EnsureDatabase(string absoluteDatabasePath);

    void TrimState(int maxRecords, int maxStateAgeDays);

    bool IsEligibleForUpload(string normalizedPath);

    void MarkSent(string normalizedPath, string filename);

    void MarkSkipped(string normalizedPath, string filename, string? errorMessage);

    void MarkFailed(string normalizedPath, string filename, string? errorMessage, int retryAfterMs);
}
