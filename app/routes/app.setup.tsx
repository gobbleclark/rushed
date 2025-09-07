import { useState, useEffect } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useFetcher, useLoaderData } from '@remix-run/react';
import {
  Page,
  Card,
  Button,
  Text,
  BlockStack,
  Banner,
  ProgressBar,
  InlineStack,
  Badge,
} from '@shopify/polaris';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '~/shopify.server';
import { PrismaClient } from '@prisma/client';
import { setupNewShop, setupExistingShop, checkShopNeedsSetup } from '~/services/setup';

const prisma = new PrismaClient();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Check if this shop needs setup
  const needsSetup = await checkShopNeedsSetup(prisma, session.shop, session.accessToken);
  
  return json({
    shopDomain: session.shop,
    needsSetup,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('action');

  try {
    if (action === 'setup') {
      const result = await setupNewShop(prisma, session.shop, session.accessToken);
      return json(result);
    }

    if (action === 'setupExisting') {
      const result = await setupExistingShop(prisma, session.shop);
      return json(result);
    }

    return json({ success: false, errors: ['Invalid action'] });
  } catch (error) {
    console.error('Setup action error:', error);
    return json({ 
      success: false, 
      errors: [error.message] 
    });
  }
};

export default function Setup() {
  const { shopDomain, needsSetup } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [setupStarted, setSetupStarted] = useState(false);
  const isLoading = fetcher.state === 'submitting';

  // Auto-start setup if needed
  useEffect(() => {
    if (needsSetup && !setupStarted && !isLoading) {
      setSetupStarted(true);
      const formData = new FormData();
      formData.append('action', 'setup');
      fetcher.submit(formData, { method: 'POST' });
    }
  }, [needsSetup, setupStarted, isLoading, fetcher]);

  // Handle setup completion
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show('Priority Handling setup completed successfully!');
      // Redirect to dashboard after successful setup
      setTimeout(() => {
        window.location.href = '/app';
      }, 2000);
    } else if (fetcher.data?.errors) {
      shopify.toast.show(`Setup issues: ${fetcher.data.errors.join(', ')}`, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleManualSetup = () => {
    const formData = new FormData();
    formData.append('action', 'setupExisting');
    fetcher.submit(formData, { method: 'POST' });
  };

  if (!needsSetup && !fetcher.data) {
    return (
      <Page>
        <TitleBar title="Priority Handling Setup" />
        <Card>
          <BlockStack gap="400">
            <Banner tone="success">
              <Text as="p" variant="bodyMd">
                ✅ Priority Handling is already set up for your store!
              </Text>
            </Banner>
            <Button onClick={() => window.location.href = '/app'} variant="primary">
              Go to Dashboard
            </Button>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Setting Up Priority Handling" />
      
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              🚀 Setting Up Priority Handling
            </Text>
            
            <Text as="p" variant="bodyMd">
              We're configuring Priority Handling for <strong>{shopDomain}</strong>. 
              This will create the necessary products and billing setup.
            </Text>

            {isLoading && (
              <BlockStack gap="300">
                <ProgressBar progress={75} />
                <Text as="p" variant="bodySm" color="subdued">
                  Creating priority product and configuring billing...
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {fetcher.data && (
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                Setup Results
              </Text>
              
              {fetcher.data.success ? (
                <Banner tone="success">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      <strong>✅ Priority Handling setup completed!</strong>
                    </Text>
                    {fetcher.data.productId && (
                      <Text as="p" variant="bodySm">
                        Product created: {fetcher.data.productId}
                      </Text>
                    )}
                    {fetcher.data.variantId && (
                      <Text as="p" variant="bodySm">
                        Variant ID: {fetcher.data.variantId}
                      </Text>
                    )}
                  </BlockStack>
                </Banner>
              ) : (
                <Banner tone="critical">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      <strong>⚠️ Setup completed with issues:</strong>
                    </Text>
                    {fetcher.data.errors.map((error, index) => (
                      <Text key={index} as="p" variant="bodySm">
                        • {error}
                      </Text>
                    ))}
                  </BlockStack>
                </Banner>
              )}

              {fetcher.data.subscriptionUrl && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      <strong>💳 Billing Setup Required</strong>
                    </Text>
                    <Text as="p" variant="bodySm">
                      You need to approve the billing subscription to complete setup.
                    </Text>
                    <Button 
                      onClick={() => window.open(fetcher.data.subscriptionUrl, '_blank')}
                      variant="primary"
                    >
                      Approve Billing Subscription
                    </Button>
                  </BlockStack>
                </Banner>
              )}
            </BlockStack>
          </Card>
        )}

        {!isLoading && !fetcher.data && needsSetup && (
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                Manual Setup
              </Text>
              <Text as="p" variant="bodyMd">
                If automatic setup didn't start, you can trigger it manually:
              </Text>
              <Button onClick={handleManualSetup} variant="primary">
                Start Setup
              </Button>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              What We're Setting Up
            </Text>
            <BlockStack gap="200">
              <InlineStack gap="200">
                <Badge tone="info">1</Badge>
                <Text as="p" variant="bodySm">
                  Creating "Priority Handling Fee" product ($5.00)
                </Text>
              </InlineStack>
              <InlineStack gap="200">
                <Badge tone="warning">2</Badge>
                <Text as="p" variant="bodySm">
                  Configuring billing subscription for usage charges
                </Text>
              </InlineStack>
              <InlineStack gap="200">
                <Badge tone="success">3</Badge>
                <Text as="p" variant="bodySm">
                  Setting up post-purchase extension for customer upsells
                </Text>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
