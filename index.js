const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const express = require('express');

// --- 1. Botの初期化 ---
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] 
});

const ticketMessages = new Map();

// --- 2. スラッシュコマンド定義 ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('認証パネル')
        .addRoleOption(o => o.setName('role').setDescription('付与するロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false)),
    new SlashCommandBuilder().setName('ticket').setDescription('チケットパネル')
        .addRoleOption(o => o.setName('admin-role').setDescription('管理者ロール').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('説明文').setRequired(false))
        .addStringOption(o => o.setName('panel-desc').setDescription('チケット発行後のメッセージ').setRequired(false)),
    new SlashCommandBuilder().setName('role-confirmation').setDescription('ロール確認')
        .addUserOption(o => o.setName('target').setDescription('対象のメンバー').setRequired(true)),
    new SlashCommandBuilder().setName('delete').setDescription('メッセージを指定数削除します')
        .addIntegerOption(o => o.setName('amount').setDescription('削除する数 (1-100)').setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('コマンドの詳細を確認できます')
].map(c => c.toJSON());

// --- 3. 起動時処理 ---
client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('コマンド登録完了！');
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }
});

const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(3000);

// --- 4. メイン処理 ---
client.on('interactionCreate', async interaction => {
    // スラッシュコマンド処理
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('ヘルプパネル')
                .setDescription('詳細を確認したいコマンドを下のプルダウンから選んでください。')
                .setColor(0x00AE86);

            const select = new StringSelectMenuBuilder()
                .setCustomId('help_select')
                .setPlaceholder('コマンドを選択してください')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('/verify').setDescription('認証パネルの作成').setValue('help_verify'),
                    new StringSelectMenuOptionBuilder().setLabel('/ticket').setDescription('チケットパネルの作成').setValue('help_ticket'),
                    new StringSelectMenuOptionBuilder().setLabel('/role-confirmation').setDescription('ロールの確認').setValue('help_role'),
                    new StringSelectMenuOptionBuilder().setLabel('/delete').setDescription('メッセージの削除').setValue('help_delete')
                );

            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (commandName === 'verify') {
            const role = options.getRole('role');
            const embed = new EmbedBuilder()
                .setTitle(options.getString('title') ?? 'ロール付与')
                .setDescription(options.getString('description') ?? '認証ボタンを押してロールを取得してください。');
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`v_role_${role.id}`).setLabel('✅認証').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticket') {
            const adminRole = options.getRole('admin-role');
            const title = options.getString('title') ?? '問い合わせ';
            const description = options.getString('description') ?? 'ボタンを押してチケットを作成してください。';
            const panelDesc = options.getString('panel-desc') ?? 'チケット発行ありがとうございます。担当者が来るまでしばらくお待ちください。';
            
            const messageKey = `msg_${Date.now()}`;
            ticketMessages.set(messageKey, panelDesc);

            const embed = new EmbedBuilder().setTitle(title).setDescription(description);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tkt_${adminRole.id}_${messageKey}`).setLabel('チケットを発行').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (commandName === 'role-confirmation') {
            const target = options.getUser('target');
            const member = await interaction.guild.members.fetch(target.id).catch(() => null);
            if (!member) return await interaction.reply({ content: 'メンバー情報が取得できませんでした。', ephemeral: true });
            const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join('\n') || 'なし';
            await interaction.reply({ content: `**${member.user.tag}** の付与ロール:\n\`\`\`\n${roles}\n\`\`\``, ephemeral: true });
        }

        if (commandName === 'delete') {
            const amount = options.getInteger('amount');
            if (amount < 1 || amount > 100) return await interaction.reply({ content: '1〜100の間で指定してください。', ephemeral: true });
            await interaction.channel.bulkDelete(amount, true).catch(console.error);
            await interaction.reply({ content: `${amount} 件のメッセージを削除しました。`, ephemeral: true });
        }
    }

    // セレクトメニュー処理 (Help)
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'help_select') {
            let helpMsg = '';
            const selected = interaction.values[0];

            if (selected === 'help_verify') helpMsg = '# /verify\nこのコマンドを使用すると、ボタンを押したユーザーに指定のロールを付与するパネルを作成します。';
            if (selected === 'help_ticket') helpMsg = '# /ticket\nこのコマンドを使用すると、チケットを作成するパネルを作成します。管理者のメンションや個別メッセージも設定可能です。';
            if (selected === 'help_role') helpMsg = '# /role-confirmation\nこのコマンドを使用すると、指定したメンバーが持っているロールを一覧で確認できます。';
            if (selected === 'help_delete') helpMsg = '# /delete\nこのコマンドは使用したチャンネル内に送信されたメッセージを、指定した数だけ削除します。';

            await interaction.update({ content: helpMsg, embeds: [], components: [interaction.message.components[0]] });
        }
    }

    // ボタン処理
    if (interaction.isButton()) {
        if (interaction.replied || interaction.deferred) return;

        if (interaction.customId.startsWith('v_role_')) {
            const roleId = interaction.customId.split('_')[2];
            await interaction.member.roles.add(roleId).catch(console.error);
            await interaction.reply({ content: 'ロールを付与しました！', ephemeral: true });
        }

        if (interaction.customId.startsWith('tkt_')) {
            const [_, adminRoleId, messageKey] = interaction.customId.split('_');
            const adminRoleMention = `<@&${adminRoleId}>`;
            const panelDesc = ticketMessages.get(messageKey) ?? 'チケット発行ありがとうございます。';

            const channel = await interaction.guild.channels.create({
                name: `🎫｜${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('delete_confirm').setLabel('チケット削除').setStyle(ButtonStyle.Danger));
            await channel.send({ content: `${interaction.user} 様\n${panelDesc}\n\n${adminRoleMention}`, components: [row] });
            await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });
        }

        if (interaction.customId === 'delete_confirm') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('delete_yes').setLabel('本当に削除する').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_no').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: '本当にこのチケットを削除しますか？', components: [row], ephemeral: true });
        }

        if (interaction.customId === 'delete_yes') await interaction.channel.delete().catch(console.error);
        if (interaction.customId === 'delete_no') await interaction.update({ content: '削除をキャンセルしました。', components: [] });
    }
});

client.login(process.env.DISCORD_TOKEN);
