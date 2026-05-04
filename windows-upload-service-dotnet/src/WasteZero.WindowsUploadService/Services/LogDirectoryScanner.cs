using Microsoft.Extensions.Logging;

namespace WasteZero.WindowsUploadService.Services;

public static class LogDirectoryScanner
{
    public static IReadOnlyList<string> ScanForLogFiles(IEnumerable<string> directories, ILogger logger)
    {
        var files = new List<string>();
        foreach (var dir in directories)
        {
            try
            {
                foreach (var path in Directory.EnumerateFiles(dir, "*", new EnumerationOptions
                         {
                             IgnoreInaccessible = true,
                             RecurseSubdirectories = false,
                             ReturnSpecialDirectories = false,
                         }))
                {
                    var name = Path.GetFileName(path).ToLowerInvariant();
                    if (name.EndsWith(".txt", StringComparison.Ordinal) || name.EndsWith(".csv", StringComparison.Ordinal))
                        files.Add(path);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to read directory {Dir}", dir);
            }
        }

        return files;
    }
}
