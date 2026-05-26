import useParsedProxy from "@/hooks/useParsedProxy";
import { cn } from "@/utils";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import copy from "copy-to-clipboard";
import { Collapsible } from "radix-ui";
import { useCallback } from "react";
import toast from "react-hot-toast";
import {
  HiCheckCircle,
  HiMinusCircle,
  HiOutlineClipboard,
  HiOutlineMapPin,
} from "react-icons/hi2";

const ProxyDetailsItem = ({ label, value }) => {
  const copyValue = useCallback(() => {
    copy(value);
    toast.success("Copied!");
  }, [value]);

  return (
    <div
      className={cn(
        "p-2.5 flex items-center gap-2 rounded-xl",
        "border bg-white/80 dark:bg-white/[0.10] backdrop-blur-md"
      )}
    >
      <div className="flex flex-col grow min-w-0">
        <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
        <span className="font-bold">{value}</span>
      </div>

      <button title={`Copy ${label}`} onClick={copyValue}>
        <HiOutlineClipboard className="size-4" />
      </button>
    </div>
  );
};

const ProxyDetails = ({ proxy, rootClassName, ...props }) => {
  const parsed = useParsedProxy(proxy);
  const query = useQuery({
    retry: 2,
    queryKey: ["proxy-details", proxy],
    enabled: Boolean(proxy),
    queryFn: ({ signal }) =>
      axios
        .get("https://ipwho.is/" + parsed.proxyHost, {
          signal,
          timeout: 5000,
        })
        .then((res) => res.data),
  });

  const ipInfo = query.data?.success ? query.data : null;
  const headingLabel = ipInfo
    ? `${ipInfo.city} - ${ipInfo.country}`
    : parsed?.proxyHost || "IP";

  return (
    <Collapsible.Root
      {...props}
      className={cn(
        "border bg-white/70 dark:bg-white/[0.06] backdrop-blur-md shadow-sm",
        "flex flex-col gap-2",
        "p-2 rounded-xl",
        rootClassName
      )}
    >
      <Collapsible.Trigger
        className={cn(
          "p-2 flex items-center gap-2 rounded-xl",
          "border bg-white/80 dark:bg-white/[0.10] backdrop-blur-md",
          "border border-transparent hover:border-nile-gold-500"
        )}
      >
        <HiOutlineMapPin className="size-5 shrink-0" />

        <h1
          title={headingLabel}
          className={cn(
            "font-bold grow min-w-0 truncate",
            "text-center flex items-center justify-center gap-2"
          )}
        >
          {ipInfo?.flag?.img ? (
            <img className="w-5 h-4 rounded-xl shrink-0" src={ipInfo?.flag?.img} />
          ) : null}{" "}
          {headingLabel}
        </h1>

        {proxy ? (
          <HiCheckCircle className="size-5 text-green-500 shrink-0" />
        ) : (
          <HiMinusCircle className="size-5 text-yellow-500 shrink-0" />
        )}
      </Collapsible.Trigger>

      <Collapsible.Content className="flex flex-col gap-2">
        {parsed ? (
          <>
            {ipInfo ? (
              <ProxyDetailsItem
                label="Location"
                value={`${ipInfo.city} - ${ipInfo.country}`}
              />
            ) : null}
            <ProxyDetailsItem label="Host" value={parsed.proxyHost} />
            <ProxyDetailsItem label="Port" value={parsed.proxyPort} />
            <ProxyDetailsItem label="Username" value={parsed.proxyUsername} />
            <ProxyDetailsItem label="Password" value={parsed.proxyPassword} />
          </>
        ) : (
          <p className="text-center">No proxy details available</p>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export default ProxyDetails;


