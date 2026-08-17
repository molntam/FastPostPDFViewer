using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class PrintRequest
{
    public string action { get; set; }
    public string fileName { get; set; }
    public string sourceUrl { get; set; }
    public string pdfBase64 { get; set; }
}

internal sealed class PrintResponse
{
    public bool ok { get; set; }
    public bool cancelled { get; set; }
    public string error { get; set; }
    public string printerName { get; set; }
    public int[] jobIds { get; set; }
}

internal sealed class WindowOwner : IWin32Window
{
    public WindowOwner(IntPtr handle)
    {
        Handle = handle;
    }

    public IntPtr Handle { get; private set; }
}

internal static class NativeMessage
{
    private const int MaxMessageBytes = 192 * 1024 * 1024;

    public static PrintRequest Read(Stream input)
    {
        byte[] header = ReadExact(input, 4);
        int length = header[0]
            | (header[1] << 8)
            | (header[2] << 16)
            | (header[3] << 24);

        if (length <= 0 || length > MaxMessageBytes)
        {
            throw new InvalidDataException("The native message has an invalid size.");
        }

        string json = Encoding.UTF8.GetString(ReadExact(input, length));
        JavaScriptSerializer serializer = CreateSerializer();
        PrintRequest request = serializer.Deserialize<PrintRequest>(json);
        if (request == null)
        {
            throw new InvalidDataException("The native print request is empty.");
        }

        return request;
    }

    public static void Write(Stream output, PrintResponse response)
    {
        JavaScriptSerializer serializer = CreateSerializer();
        byte[] body = Encoding.UTF8.GetBytes(serializer.Serialize(response));
        byte[] header = new byte[]
        {
            (byte)(body.Length & 0xff),
            (byte)((body.Length >> 8) & 0xff),
            (byte)((body.Length >> 16) & 0xff),
            (byte)((body.Length >> 24) & 0xff),
        };

        output.Write(header, 0, header.Length);
        output.Write(body, 0, body.Length);
        output.Flush();
    }

    private static JavaScriptSerializer CreateSerializer()
    {
        return new JavaScriptSerializer
        {
            MaxJsonLength = MaxMessageBytes,
            RecursionLimit = 20,
        };
    }

    private static byte[] ReadExact(Stream input, int length)
    {
        byte[] buffer = new byte[length];
        int offset = 0;

        while (offset < length)
        {
            int read = input.Read(buffer, offset, length - offset);
            if (read <= 0)
            {
                throw new EndOfStreamException("The native message ended unexpectedly.");
            }
            offset += read;
        }

        return buffer;
    }
}

internal static class RawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string documentName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string outputFile;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string dataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr printer, int level, ref DocInfo docInfo);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printer, IntPtr data, int count, out int written);

    [DllImport("winspool.drv", EntryPoint = "AbortPrinter", SetLastError = true)]
    private static extern bool AbortPrinter(IntPtr printer);

    public static int Submit(string printerName, string documentName, byte[] pdf)
    {
        IntPtr printer;
        if (!OpenPrinter(printerName, out printer, IntPtr.Zero))
        {
            ThrowLastWin32Error("Windows could not open the selected printer.");
        }

        bool documentStarted = false;
        bool pageStarted = false;
        try
        {
            DocInfo info = new DocInfo
            {
                documentName = documentName,
                outputFile = null,
                dataType = "RAW",
            };

            int jobId = StartDocPrinter(printer, 1, ref info);
            if (jobId == 0)
            {
                ThrowLastWin32Error("Windows could not create the RAW PDF print job.");
            }
            documentStarted = true;

            if (!StartPagePrinter(printer))
            {
                ThrowLastWin32Error("Windows could not start the print page.");
            }
            pageStarted = true;

            WriteAll(printer, pdf);

            if (!EndPagePrinter(printer))
            {
                ThrowLastWin32Error("Windows could not finish the print page.");
            }
            pageStarted = false;

            if (!EndDocPrinter(printer))
            {
                ThrowLastWin32Error("Windows could not submit the PDF to the print queue.");
            }
            documentStarted = false;
            return jobId;
        }
        catch
        {
            if (pageStarted)
            {
                EndPagePrinter(printer);
            }
            if (documentStarted)
            {
                AbortPrinter(printer);
            }
            throw;
        }
        finally
        {
            ClosePrinter(printer);
        }
    }

    private static void WriteAll(IntPtr printer, byte[] data)
    {
        const int ChunkSize = 1024 * 1024;
        GCHandle pinned = GCHandle.Alloc(data, GCHandleType.Pinned);
        try
        {
            int offset = 0;
            while (offset < data.Length)
            {
                int count = Math.Min(ChunkSize, data.Length - offset);
                int written;
                IntPtr source = IntPtr.Add(pinned.AddrOfPinnedObject(), offset);
                if (!WritePrinter(printer, source, count, out written))
                {
                    ThrowLastWin32Error("Windows could not write the PDF to the print queue.");
                }
                if (written <= 0)
                {
                    throw new IOException("The print queue accepted no PDF data.");
                }
                offset += written;
            }
        }
        finally
        {
            pinned.Free();
        }
    }

    private static void ThrowLastWin32Error(string message)
    {
        int error = Marshal.GetLastWin32Error();
        throw new Win32Exception(error, message);
    }
}

internal static class Program
{
    private const int MaxPdfBytes = 128 * 1024 * 1024;
    private const string AllowedOrigin = "https://solutions.inet-logistics.com";

    [STAThread]
    private static int Main(string[] args)
    {
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();

        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            PrintRequest request = NativeMessage.Read(input);
            PrintResponse response = HandleRequest(request, GetParentWindow(args));
            NativeMessage.Write(output, response);
            return response.ok || response.cancelled ? 0 : 1;
        }
        catch (Exception error)
        {
            try
            {
                NativeMessage.Write(output, new PrintResponse
                {
                    ok = false,
                    error = error.GetType().Name + ": " + error.Message,
                });
            }
            catch
            {
            }
            return 1;
        }
    }

    private static PrintResponse HandleRequest(PrintRequest request, IntPtr parentWindow)
    {
        if (!string.Equals(request.action, "printPdf", StringComparison.Ordinal))
        {
            throw new InvalidDataException("The requested native action is not supported.");
        }
        if (!IsAllowedSourceUrl(request.sourceUrl))
        {
            throw new InvalidDataException("The PDF source is not allowed.");
        }
        if (string.IsNullOrEmpty(request.pdfBase64)
            || request.pdfBase64.Length > ((long)MaxPdfBytes + 2L) / 3L * 4L + 8L)
        {
            throw new InvalidDataException("The PDF payload is empty or too large.");
        }

        byte[] pdf;
        try
        {
            pdf = Convert.FromBase64String(request.pdfBase64);
        }
        catch (FormatException)
        {
            throw new InvalidDataException("The PDF payload is not valid Base64.");
        }

        if (pdf.Length == 0 || pdf.Length > MaxPdfBytes || !HasPdfHeader(pdf))
        {
            throw new InvalidDataException("The captured payload is not a valid PDF.");
        }

        string documentName = SanitizeDocumentName(request.fileName);
        string printerName;
        short copies;
        if (!SelectPrinter(parentWindow, out printerName, out copies))
        {
            return new PrintResponse
            {
                ok = false,
                cancelled = true,
            };
        }

        List<int> jobIds = new List<int>();
        for (int copy = 0; copy < copies; copy++)
        {
            string jobName = copies > 1
                ? documentName + " (" + (copy + 1) + "/" + copies + ")"
                : documentName;
            jobIds.Add(RawPrinter.Submit(printerName, jobName, pdf));
        }

        return new PrintResponse
        {
            ok = true,
            printerName = printerName,
            jobIds = jobIds.ToArray(),
        };
    }

    private static bool SelectPrinter(IntPtr parentWindow, out string printerName, out short copies)
    {
        using (PrintDocument document = new PrintDocument())
        using (PrintDialog dialog = new PrintDialog())
        {
            dialog.Document = document;
            dialog.AllowCurrentPage = false;
            dialog.AllowPrintToFile = false;
            dialog.AllowSelection = false;
            dialog.AllowSomePages = false;
            dialog.ShowHelp = false;
            dialog.UseEXDialog = true;

            DialogResult result = parentWindow != IntPtr.Zero
                ? dialog.ShowDialog(new WindowOwner(parentWindow))
                : dialog.ShowDialog();

            if (result != DialogResult.OK)
            {
                printerName = null;
                copies = 0;
                return false;
            }

            if (!dialog.PrinterSettings.IsValid)
            {
                throw new InvalidOperationException("The selected printer is not available.");
            }

            printerName = dialog.PrinterSettings.PrinterName;
            copies = Math.Max((short)1, dialog.PrinterSettings.Copies);
            return true;
        }
    }

    private static IntPtr GetParentWindow(string[] args)
    {
        const string Prefix = "--parent-window=";
        foreach (string argument in args)
        {
            if (!argument.StartsWith(Prefix, StringComparison.Ordinal))
            {
                continue;
            }

            long value;
            if (long.TryParse(argument.Substring(Prefix.Length), out value) && value > 0)
            {
                return new IntPtr(value);
            }
        }

        return IntPtr.Zero;
    }

    private static bool IsAllowedSourceUrl(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri)
            && uri.IsDefaultPort
            && string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.Host, "solutions.inet-logistics.com", StringComparison.OrdinalIgnoreCase)
            && string.Equals(uri.GetLeftPart(UriPartial.Authority), AllowedOrigin, StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasPdfHeader(byte[] data)
    {
        byte[] signature = Encoding.ASCII.GetBytes("%PDF-");
        int searchLength = Math.Min(data.Length, 1024);

        for (int offset = 0; offset <= searchLength - signature.Length; offset++)
        {
            bool match = true;
            for (int index = 0; index < signature.Length; index++)
            {
                if (data[offset + index] != signature[index])
                {
                    match = false;
                    break;
                }
            }
            if (match)
            {
                return true;
            }
        }

        return false;
    }

    private static string SanitizeDocumentName(string value)
    {
        string name = string.IsNullOrWhiteSpace(value) ? "document.pdf" : Path.GetFileName(value);
        foreach (char invalid in Path.GetInvalidFileNameChars())
        {
            name = name.Replace(invalid, '_');
        }

        name = name.Trim();
        if (name.Length == 0)
        {
            name = "document.pdf";
        }
        if (!name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            name += ".pdf";
        }
        if (name.Length > 180)
        {
            name = name.Substring(0, 176) + ".pdf";
        }

        return name;
    }
}
