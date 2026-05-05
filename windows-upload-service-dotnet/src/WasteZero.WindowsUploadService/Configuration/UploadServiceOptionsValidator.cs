using Microsoft.Extensions.Options;

namespace WasteZero.WindowsUploadService.Configuration;

/// <summary>
/// Normalizes bound configuration (trim paths, clamp polling interval).
/// </summary>
public sealed class UploadServiceOptionsPostConfigure : IPostConfigureOptions<UploadServiceOptions>
{
    public void PostConfigure(string? name, UploadServiceOptions o)
    {
        o.ApiEndpoint = o.ApiEndpoint?.Trim() ?? "";
        o.ApiKey = o.ApiKey?.Trim() ?? "";
        o.VercelProtectionBypass = o.VercelProtectionBypass?.Trim() ?? "";
        o.DatabasePath = string.IsNullOrWhiteSpace(o.DatabasePath) ? "upload_state.db" : o.DatabasePath.Trim();
        o.LogDir = string.IsNullOrWhiteSpace(o.LogDir) ? "logs" : o.LogDir.Trim();

        if (o.PollingIntervalSeconds < 5)
            o.PollingIntervalSeconds = 5;

        if (o.LogMaxSizeBytes < 0)
            o.LogMaxSizeBytes = 0;
        if (o.LogMaxBackups < 0)
            o.LogMaxBackups = 0;
        if (o.MaxStateRecords < 0)
            o.MaxStateRecords = 0;
        if (o.MaxStateAgeDays < 0)
            o.MaxStateAgeDays = 0;

        o.WatchDirectories ??= new List<string>();
        o.WatchDirectories = o.WatchDirectories
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s.Trim())
            .ToList();
    }
}

/// <summary>
/// Validates <see cref="UploadServiceOptions"/> when the host starts (ValidateOnStart).
/// </summary>
public sealed class UploadServiceOptionsValidator : IValidateOptions<UploadServiceOptions>
{
    public ValidateOptionsResult Validate(string? name, UploadServiceOptions o)
    {
        if (o.WatchDirectories.Count == 0)
        {
            return ValidateOptionsResult.Fail(
                "UploadService:WatchDirectories must contain at least one path. " +
                "Set them in appsettings.json, appsettings.{Environment}.json, user secrets, or environment variables " +
                "(e.g. UploadService__WatchDirectories__0).");
        }

        if (string.IsNullOrWhiteSpace(o.ApiEndpoint) || string.IsNullOrWhiteSpace(o.ApiKey))
        {
            return ValidateOptionsResult.Fail(
                "UploadService:ApiEndpoint and UploadService:ApiKey are required. " +
                "Do not commit secrets: use dotnet user-secrets (Development), machine environment variables, or a secured appsettings.Production.json on the server.");
        }

        return ValidateOptionsResult.Success;
    }
}
