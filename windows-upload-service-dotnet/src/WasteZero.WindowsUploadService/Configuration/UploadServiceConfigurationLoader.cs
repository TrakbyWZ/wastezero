using System.Text.Json;

namespace WasteZero.WindowsUploadService.Configuration;

public static class UploadServiceConfigurationLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static UploadServiceOptions Load(string contentRoot)
    {
        var options = new UploadServiceOptions();
        var configPath = Path.Combine(contentRoot, "config.json");
        if (File.Exists(configPath))
        {
            try
            {
                var json = File.ReadAllText(configPath);
                var fromFile = JsonSerializer.Deserialize<UploadServiceOptions>(json, JsonOptions);
                if (fromFile != null)
                    CopyNonDefaults(fromFile, options);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"Invalid config.json: {ex.Message}", ex);
            }
        }

        ApplyEnvironmentOverrides(options);
        Validate(options);
        return options;
    }

    private static void CopyNonDefaults(UploadServiceOptions from, UploadServiceOptions to)
    {
        if (from.WatchDirectories.Count > 0) to.WatchDirectories = from.WatchDirectories;
        if (!string.IsNullOrWhiteSpace(from.ApiEndpoint)) to.ApiEndpoint = from.ApiEndpoint.Trim();
        if (!string.IsNullOrWhiteSpace(from.ApiKey)) to.ApiKey = from.ApiKey;
        if (from.VercelProtectionBypass != null) to.VercelProtectionBypass = from.VercelProtectionBypass.Trim();
        if (from.PollingIntervalSeconds > 0) to.PollingIntervalSeconds = from.PollingIntervalSeconds;
        if (!string.IsNullOrWhiteSpace(from.DatabasePath)) to.DatabasePath = from.DatabasePath.Trim();
        if (!string.IsNullOrWhiteSpace(from.LogDir)) to.LogDir = from.LogDir.Trim();
        if (from.LogMaxSizeBytes >= 0) to.LogMaxSizeBytes = from.LogMaxSizeBytes;
        if (from.LogMaxBackups >= 0) to.LogMaxBackups = from.LogMaxBackups;
        if (from.MaxStateRecords >= 0) to.MaxStateRecords = from.MaxStateRecords;
        if (from.MaxStateAgeDays >= 0) to.MaxStateAgeDays = from.MaxStateAgeDays;
    }

    private static void ApplyEnvironmentOverrides(UploadServiceOptions o)
    {
        var wd = Environment.GetEnvironmentVariable("WATCH_DIRECTORIES");
        if (!string.IsNullOrWhiteSpace(wd))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<List<string>>(wd, JsonOptions);
                if (parsed is { Count: > 0 }) o.WatchDirectories = parsed;
            }
            catch
            {
                o.WatchDirectories = wd.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(s => s.Length > 0)
                    .ToList();
            }
        }

        var ep = Environment.GetEnvironmentVariable("API_ENDPOINT");
        if (!string.IsNullOrWhiteSpace(ep)) o.ApiEndpoint = ep.Trim();

        var key = Environment.GetEnvironmentVariable("API_KEY");
        if (!string.IsNullOrWhiteSpace(key)) o.ApiKey = key;

        var bypass = Environment.GetEnvironmentVariable("VERCEL_PROTECTION_BYPASS")
                     ?? Environment.GetEnvironmentVariable("VERCEL_AUTOMATION_BYPASS_SECRET");
        if (!string.IsNullOrWhiteSpace(bypass)) o.VercelProtectionBypass = bypass.Trim();

        if (int.TryParse(Environment.GetEnvironmentVariable("POLLING_INTERVAL"), out var poll) && poll > 0)
            o.PollingIntervalSeconds = poll;

        var db = Environment.GetEnvironmentVariable("DATABASE_PATH")
                 ?? Environment.GetEnvironmentVariable("STATE_DATABASE");
        if (!string.IsNullOrWhiteSpace(db)) o.DatabasePath = db.Trim();

        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LOG_DIR")))
            o.LogDir = Environment.GetEnvironmentVariable("LOG_DIR")!.Trim();

        if (long.TryParse(Environment.GetEnvironmentVariable("LOG_MAX_SIZE_BYTES"), out var maxLog) && maxLog >= 0)
            o.LogMaxSizeBytes = maxLog;

        if (int.TryParse(Environment.GetEnvironmentVariable("LOG_MAX_BACKUPS"), out var backups) && backups >= 0)
            o.LogMaxBackups = backups;

        if (int.TryParse(Environment.GetEnvironmentVariable("MAX_STATE_RECORDS"), out var maxRec) && maxRec >= 0)
            o.MaxStateRecords = maxRec;

        if (int.TryParse(Environment.GetEnvironmentVariable("MAX_STATE_AGE_DAYS"), out var maxAge) && maxAge >= 0)
            o.MaxStateAgeDays = maxAge;
    }

    public static void Validate(UploadServiceOptions o)
    {
        if (o.WatchDirectories.Count == 0)
            throw new InvalidOperationException(
                "At least one watch directory is required (watchDirectories in config.json or WATCH_DIRECTORIES).");

        if (string.IsNullOrWhiteSpace(o.ApiEndpoint) || string.IsNullOrWhiteSpace(o.ApiKey))
            throw new InvalidOperationException(
                "apiEndpoint and apiKey are required (config.json or API_ENDPOINT and API_KEY).");

        if (o.PollingIntervalSeconds < 5)
            o.PollingIntervalSeconds = 5;
    }
}
