namespace WasteZero.WindowsUploadService.Configuration;

/// <summary>
/// Runtime options for the upload worker, bound from configuration section <c>UploadService</c> (appsettings, environment variables, user secrets).
/// </summary>
public sealed class UploadServiceOptions
{
    public List<string> WatchDirectories { get; set; } = new();

    public string ApiEndpoint { get; set; } = "";

    public string ApiKey { get; set; } = "";

    public string VercelProtectionBypass { get; set; } = "";

    public int PollingIntervalSeconds { get; set; } = 60;

    /// <summary>SQLite database path (absolute or relative to the service install directory).</summary>
    public string DatabasePath { get; set; } = "upload_state.db";

    public string LogDir { get; set; } = "logs";

    public long LogMaxSizeBytes { get; set; } = 5 * 1024 * 1024;

    public int LogMaxBackups { get; set; } = 3;

    public int MaxStateRecords { get; set; }

    public int MaxStateAgeDays { get; set; }
}
