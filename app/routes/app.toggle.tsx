import { useState, useCallback, useEffect } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useFetcher, useLoaderData, Link } from '@remix-run/react';
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Banner,
  Checkbox,
} from '@shopify/polaris';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '~/shopify.server';
import { PrismaClient } from '@prisma/client';
import { calculateSLA, getSLAMessage, isPriorityHandlingAvailable, getTimeUntilCutoff } from '~/services/sla';

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get shop settings
  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  
  if (!shop) {
    throw new Error('Shop not found');
  }

  // Get current SLA information
  const slaInfo = calculateSLA(shop.timezone);
  const slaMessage = getSLAMessage(shop.timezone);
  const isCurrentlyAvailable = isPriorityHandlingAvailable(shop.timezone);
  const timeUntilCutoff = getTimeUntilCutoff(shop.timezone);

  return json({
    shop: {
      id: shop.id,
      domain: shop.domain,
      feeCents: shop.feeCents,
      slaHours: shop.slaHours,
    },
    slaInfo,
    slaMessage,
    isCurrentlyAvailable,
    timeUntilCutoff,
    isEnabled: shop.feeCents > 0,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('action');

  try {
    if (action === 'toggle') {
      const enabled = formData.get('enabled') === 'true';
      
      await prisma.shop.update({
        where: { domain: session.shop },
        data: {
          feeCents: enabled ? 500 : 0, // $5.00 when enabled, $0 when disabled
        },
      });

      return json({ 
        success: true, 
        message: enabled ? 'Priority Handling enabled!' : 'Priority Handling disabled'
      });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Toggle action error:', error);
    return json({ error: error.message }, { status: 500 });
  }
};

export default function Toggle() {
  const { shop, slaInfo, slaMessage, isCurrentlyAvailable, timeUntilCutoff, isEnabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [enabled, setEnabled] = useState(isEnabled);
  const isLoading = fetcher.state === 'submitting';

  // Show success/error messages
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(fetcher.data.message);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleToggle = useCallback(() => {
    const formData = new FormData();
    formData.append('action', 'toggle');
    formData.append('enabled', enabled.toString());
    
    fetcher.submit(formData, { method: 'POST' });
  }, [enabled, fetcher]);

  return (
    <Page>
      <TitleBar title="Priority Handling Control" />
      
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Main Toggle */}
            <Card>
              <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingXl">
                      Priority Handling
                    </Text>
                    <Text as="p" variant="bodyLg" color="subdued">
                      Let customers pay $5 to skip the line
                    </Text>
                  </BlockStack>
                  
                  <InlineStack gap="400" blockAlign="center">
                    <Badge tone={enabled ? "success" : "critical"} size="large">
                      {enabled ? "ON" : "OFF"}
                    </Badge>
                    <Checkbox
                      checked={enabled}
                      onChange={setEnabled}
                    />
                  </InlineStack>
                </InlineStack>

                <Button
                  variant="primary"
                  onClick={handleToggle}
                  loading={isLoading}
                  size="large"
                  fullWidth
                >
                  {enabled ? 'Turn OFF Priority Handling' : 'Turn ON Priority Handling'}
                </Button>
              </BlockStack>
            </Card>

            {/* Current SLA Status */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Current Service Level
                </Text>
                
                <Banner tone={isCurrentlyAvailable ? "success" : "warning"}>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      {slaMessage}
                    </Text>
                    {isCurrentlyAvailable && (
                      <Text as="p" variant="bodySm" color="subdued">
                        ⏰ {timeUntilCutoff}
                      </Text>
                    )}
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Card>

            {/* 3PL Requirements */}
            {enabled && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    ⚠️ Fulfillment Team Requirements
                  </Text>
                  
                  <Banner tone="critical">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        <strong>Before enabling, ensure your 3PL/fulfillment team can:</strong>
                      </Text>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm">
                          • Monitor orders tagged with <Badge tone="info">PRIORITY_SKIP_LINE</Badge>
                        </Text>
                        <Text as="p" variant="bodySm">
                          • Pick and pack within 3 hours (orders before 8PM EST)
                        </Text>
                        <Text as="p" variant="bodySm">
                          • Process next business day (orders after 8PM EST)
                        </Text>
                      </BlockStack>
                    </BlockStack>
                  </Banner>
                </BlockStack>
              </Card>
            )}

            {/* Navigation */}
            <InlineStack gap="300">
              <Link to="/app" style={{ textDecoration: 'none' }}>
                <Button>
                  ← Back to Dashboard
                </Button>
              </Link>
              <Button 
                onClick={() => window.open(`https://admin.shopify.com/store/${shop.domain.replace('.myshopify.com', '')}/orders?query=tag:PRIORITY_SKIP_LINE`, '_blank')}
                variant="secondary"
              >
                View Priority Orders
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
