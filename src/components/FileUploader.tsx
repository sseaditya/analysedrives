import { useCallback, useState } from "react";
import { Upload, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploaderProps {
  onFilesLoad: (files: { content: string; name: string }[]) => void;
  isLoading?: boolean;
}

const FileUploader = ({ onFilesLoad, isLoading }: FileUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const gpxFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith(".gpx"));

    if (gpxFiles.length === 0) {
      alert("Please upload valid GPX files");
      return;
    }

    const results: { content: string; name: string }[] = [];

    // Read all files
    for (const file of gpxFiles) {
      try {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
        });
        results.push({ content, name: file.name });
      } catch (error) {
        console.error(`Failed to read file ${file.name}`, error);
      }
    }

    if (results.length > 0) {
      setFileName(`${results.length} file${results.length > 1 ? 's' : ''}`);
      onFilesLoad(results);
    }
  }, [onFilesLoad]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
      }
    },
    [processFiles]
  );

  const clearFile = useCallback(() => {
    setFileName(null);
  }, []);

  return (
    <div
      className={cn(
        "relative border-2 border-dashed rounded-2xl p-8 md:p-12 transition-all duration-300 cursor-pointer group",
        isDragging
          ? "border-primary bg-primary/5 scale-[1.02]"
          : "border-border hover:border-primary/50 hover:bg-accent/50",
        isLoading && "opacity-50 pointer-events-none"
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        type="file"
        accept=".gpx"
        multiple // Enable multiple files
        onChange={handleInputChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={isLoading}
      />

      <div className="flex flex-col items-center justify-center text-center space-y-4">
        {fileName ? (
          <>
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <FileText className="w-8 h-8 text-primary" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground font-medium">{fileName}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
                className="p-1 hover:bg-destructive/10 rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Click or drag to upload different files
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Upload className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
            </div>
            <div>
              <p className="text-lg font-medium text-foreground">
                Drop your GPX files here
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                or click to browse multiple files
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Supports .gpx files from GPS devices and apps
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default FileUploader;
